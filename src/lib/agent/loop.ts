/**
 * A small tool-calling agent loop for both providers in llm.ts.
 *
 * The model calls read tools as many times as it needs (up to `maxSteps`
 * turns), then must call the terminal tool, whose input is the final answer.
 * Every tool input is checked with Zod before the tool runs; a bad input goes
 * back to the model as an error instead of crashing the request. On the last
 * turn only the terminal tool is offered, so the loop always ends.
 *
 * Tools never change stored data. Anything that would (saving a plan) stays a
 * user action in the UI, as in the rest of Pivot.
 */
import { z } from "zod";
import { config, jsonSchema, LlmError, postJson, type Config } from "./llm";

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => unknown | Promise<unknown>;
}

export const tool = <S extends z.ZodType>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallMsg {
  id: string;
  name: string;
  input: unknown;
}

export type LoopMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; calls: ToolCallMsg[] }
  | { role: "tool_results"; results: { id: string; name: string; content: string }[] };

export interface ClientRequest {
  system: string;
  messages: LoopMessage[];
  tools: ToolSpec[];
  /** "any": must call some tool. Otherwise the tool it must call. */
  toolChoice: "any" | { name: string };
  maxTokens: number;
  model?: string;
}

export interface ClientTurn {
  text: string;
  calls: ToolCallMsg[];
  usage: { inputTokens: number; outputTokens: number };
}

/** One model turn. Swappable so tests and evals can script the model. */
export type LoopClient = (req: ClientRequest) => Promise<ClientTurn>;

export interface TraceStep {
  step: number;
  tool: string;
  input: unknown;
  ok: boolean;
  error?: string;
  ms: number;
}

export interface LoopOptions<F extends z.ZodType> {
  system: string;
  user: string;
  tools: AgentTool[];
  final: { name: string; description: string; schema: F };
  maxSteps?: number;
  maxTokens?: number;
  model?: string;
  client?: LoopClient;
}

export interface LoopResult<T> {
  output: T;
  trace: TraceStep[];
  steps: number;
  usage: { model: string; inputTokens: number; outputTokens: number };
}

const MAX_RESULT_CHARS = 8000;

export async function runToolLoop<F extends z.ZodType>(o: LoopOptions<F>): Promise<LoopResult<z.infer<F>>> {
  const maxSteps = o.maxSteps ?? 8;
  const client = o.client ?? defaultClient();
  const specs: ToolSpec[] = [...o.tools, o.final].map((t) => ({ name: t.name, description: t.description, parameters: jsonSchema(t.schema) }));
  const finalSpec = specs[specs.length - 1];
  const messages: LoopMessage[] = [{ role: "user", content: o.user }];
  const trace: TraceStep[] = [];
  const usage = { model: o.model ?? config().model, inputTokens: 0, outputTokens: 0 };

  for (let step = 1; step <= maxSteps; step++) {
    const last = step === maxSteps;
    const turn = await client({
      system: o.system,
      messages,
      tools: last ? [finalSpec] : specs,
      toolChoice: last ? { name: o.final.name } : "any",
      maxTokens: o.maxTokens ?? 4096,
      model: o.model,
    });
    usage.inputTokens += turn.usage.inputTokens;
    usage.outputTokens += turn.usage.outputTokens;

    if (!turn.calls.length) {
      messages.push({ role: "assistant", text: turn.text || "(no tool call)", calls: [] });
      messages.push({ role: "user", content: `Use the tools. When you are ready, call ${o.final.name}.` });
      continue;
    }
    messages.push({ role: "assistant", text: turn.text, calls: turn.calls });

    const results: { id: string; name: string; content: string }[] = [];
    for (const call of turn.calls) {
      const started = Date.now();
      if (call.name === o.final.name) {
        const parsed = o.final.schema.safeParse(call.input);
        if (parsed.success) {
          trace.push({ step, tool: call.name, input: call.input, ok: true, ms: Date.now() - started });
          return { output: parsed.data, trace, steps: step, usage };
        }
        const error = formatIssues(parsed.error);
        trace.push({ step, tool: call.name, input: call.input, ok: false, error, ms: Date.now() - started });
        results.push({ id: call.id, name: call.name, content: `Error: the answer didn't match the schema. ${error} Fix it and call ${o.final.name} again.` });
        continue;
      }
      const t = o.tools.find((x) => x.name === call.name);
      if (!t) {
        trace.push({ step, tool: call.name, input: call.input, ok: false, error: "unknown tool", ms: 0 });
        results.push({ id: call.id, name: call.name, content: `Error: there is no tool named ${call.name}.` });
        continue;
      }
      const parsed = t.schema.safeParse(call.input ?? {});
      if (!parsed.success) {
        const error = formatIssues(parsed.error);
        trace.push({ step, tool: call.name, input: call.input, ok: false, error, ms: Date.now() - started });
        results.push({ id: call.id, name: call.name, content: `Error: invalid input. ${error}` });
        continue;
      }
      try {
        const out = await t.run(parsed.data);
        let content = JSON.stringify(out);
        if (content.length > MAX_RESULT_CHARS) content = content.slice(0, MAX_RESULT_CHARS) + "…(truncated)";
        trace.push({ step, tool: call.name, input: parsed.data, ok: true, ms: Date.now() - started });
        results.push({ id: call.id, name: call.name, content });
      } catch (e) {
        const error = (e as Error).message || "tool failed";
        trace.push({ step, tool: call.name, input: parsed.data, ok: false, error, ms: Date.now() - started });
        results.push({ id: call.id, name: call.name, content: `Error: ${error}` });
      }
    }
    messages.push({ role: "tool_results", results });
  }
  throw new LlmError(`The agent did not finish within ${maxSteps} steps.`);
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

// ---------- provider clients ----------

export function defaultClient(): LoopClient {
  return async (req) => {
    const cfg = { ...config(), ...(req.model ? { model: req.model } : {}) };
    if (!cfg.apiKey) throw new LlmError("AI is not configured (missing LLM_API_KEY).");
    return cfg.provider === "openai" ? openAiTurn(req, cfg) : anthropicTurn(req, cfg);
  };
}

async function anthropicTurn(req: ClientRequest, cfg: Config): Promise<ClientTurn> {
  const messages = req.messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant")
      return {
        role: "assistant",
        content: [
          ...(m.text ? [{ type: "text", text: m.text }] : []),
          ...m.calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input ?? {} })),
        ],
      };
    return { role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content })) };
  });
  const data = await postJson(
    `${cfg.baseUrl}/v1/messages`,
    { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: cfg.model,
      max_tokens: req.maxTokens,
      system: req.system,
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      tool_choice: req.toolChoice === "any" ? { type: "any" } : { type: "tool", name: req.toolChoice.name },
      messages,
    },
  );
  const content = (data.content ?? []) as { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  return {
    text: content.filter((c) => c.type === "text").map((c) => c.text).join("\n"),
    calls: content.filter((c) => c.type === "tool_use").map((c) => ({ id: c.id!, name: c.name!, input: c.input })),
    usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
  };
}

async function openAiTurn(req: ClientRequest, cfg: Config): Promise<ClientTurn> {
  const messages: unknown[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      messages.push({
        role: "assistant",
        content: m.text || null,
        ...(m.calls.length
          ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
          : {}),
      });
    else for (const r of m.results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  const data = await postJson(
    `${cfg.baseUrl}/chat/completions`,
    { authorization: `Bearer ${cfg.apiKey}` },
    {
      model: cfg.model,
      messages,
      tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: req.toolChoice === "any" ? "required" : { type: "function", function: { name: req.toolChoice.name } },
    },
  );
  const msg = data.choices?.[0]?.message ?? {};
  const calls = ((msg.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[]).map((c) => {
    let input: unknown = {};
    try {
      input = JSON.parse(c.function.arguments || "{}");
    } catch {
      input = { __unparsable: c.function.arguments };
    }
    return { id: c.id, name: c.function.name, input };
  });
  return {
    text: typeof msg.content === "string" ? msg.content : "",
    calls,
    usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
  };
}
