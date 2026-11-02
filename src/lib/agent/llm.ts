/**
 * Minimal LLM client for the agent routes. Server-side only: it reads the API
 * key from the environment, so never import it from a client component.
 *
 * Every call forces exactly one tool call whose input is checked against a Zod
 * schema, so the rest of the app only ever sees structured, typed output.
 *
 * Providers (same env vars as the time-assistant prototype):
 *   LLM_PROVIDER=openai     any OpenAI-compatible gateway, e.g. Stanford AI API Gateway
 *   LLM_PROVIDER=anthropic  Claude API direct (also picked when only ANTHROPIC_API_KEY is set)
 */
import { z } from "zod";

/** Read at call time, so scripts (e.g. the eval runner) can load env files first. */
function config() {
  const env = process.env;
  const provider = env.LLM_PROVIDER || (env.LLM_API_KEY ? "openai" : "anthropic");
  return {
    apiKey: env.LLM_API_KEY || env.ANTHROPIC_API_KEY || "",
    provider,
    model: env.LLM_MODEL || env.ANTHROPIC_MODEL || (provider === "openai" ? "gpt-5.4-mini" : "claude-sonnet-5-5"),
    baseUrl: (
      env.LLM_BASE_URL ||
      env.ANTHROPIC_BASE_URL ||
      (provider === "openai" ? "https://aiapi-prod.stanford.edu/v1" : "https://api.anthropic.com")
    ).replace(/\/$/, ""),
  };
}

export const aiEnabled = () => Boolean(config().apiKey);
export const modelName = () => config().model;

export class LlmError extends Error {}

export interface ToolCall<T extends z.ZodType> {
  system: string;
  user: string;
  name: string;
  description: string;
  schema: T;
  maxTokens?: number;
  /** Overrides LLM_MODEL, e.g. to compare model sizes in evals. */
  model?: string;
}

export interface LlmResult<T> {
  output: T;
  usage: { model: string; inputTokens: number; outputTokens: number };
}

function jsonSchema(schema: z.ZodType) {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export async function callTool<T extends z.ZodType>(call: ToolCall<T>): Promise<LlmResult<z.infer<T>>> {
  const cfg = { ...config(), ...(call.model ? { model: call.model } : {}) };
  if (!cfg.apiKey) throw new LlmError("AI is not configured (missing LLM_API_KEY).");
  const raw = cfg.provider === "openai" ? await callOpenAI(call, cfg) : await callAnthropic(call, cfg);
  const parsed = call.schema.safeParse(raw.input);
  if (!parsed.success) {
    throw new LlmError(`The model's answer didn't match the expected format: ${parsed.error.issues[0]?.message ?? ""}`);
  }
  return { output: parsed.data, usage: { model: cfg.model, ...raw.usage } };
}

interface RawResult {
  input: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new LlmError(data?.error?.message || `LLM API error ${r.status}`);
  return data;
}

type Config = ReturnType<typeof config>;

async function callAnthropic(call: ToolCall<z.ZodType>, cfg: Config): Promise<RawResult> {
  const data = await postJson(
    `${cfg.baseUrl}/v1/messages`,
    { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: cfg.model,
      max_tokens: call.maxTokens ?? 4096,
      system: call.system,
      tools: [{ name: call.name, description: call.description, input_schema: jsonSchema(call.schema) }],
      tool_choice: { type: "tool", name: call.name },
      messages: [{ role: "user", content: call.user }],
    },
  );
  const tool = (data.content ?? []).find((c: { type: string; name?: string }) => c.type === "tool_use" && c.name === call.name);
  if (!tool) throw new LlmError("The model did not return a structured answer.");
  return { input: tool.input, usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 } };
}

async function callOpenAI(call: ToolCall<z.ZodType>, cfg: Config): Promise<RawResult> {
  const data = await postJson(
    `${cfg.baseUrl}/chat/completions`,
    { authorization: `Bearer ${cfg.apiKey}` },
    {
      model: cfg.model,
      messages: [
        { role: "system", content: call.system },
        { role: "user", content: call.user },
      ],
      tools: [{ type: "function", function: { name: call.name, description: call.description, parameters: jsonSchema(call.schema) } }],
      tool_choice: { type: "function", function: { name: call.name } },
    },
  );
  const msg = data.choices?.[0]?.message ?? {};
  const fn = (msg.tool_calls ?? [])[0]?.function;
  let input: unknown;
  try {
    input = fn ? JSON.parse(fn.arguments || "{}") : JSON.parse(String(msg.content).match(/\{[\s\S]*\}/)?.[0] ?? "");
  } catch {
    throw new LlmError("The model did not return a structured answer.");
  }
  return {
    input,
    usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
  };
}
