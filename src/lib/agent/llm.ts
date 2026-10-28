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

const env = process.env;
const API_KEY = env.LLM_API_KEY || env.ANTHROPIC_API_KEY || "";
const PROVIDER = env.LLM_PROVIDER || (env.LLM_API_KEY ? "openai" : "anthropic");
export const MODEL =
  env.LLM_MODEL || env.ANTHROPIC_MODEL || (PROVIDER === "openai" ? "gpt-5.4-mini" : "claude-sonnet-5-5");
const BASE_URL = (
  env.LLM_BASE_URL ||
  env.ANTHROPIC_BASE_URL ||
  (PROVIDER === "openai" ? "https://aiapi-prod.stanford.edu/v1" : "https://api.anthropic.com")
).replace(/\/$/, "");

export const aiEnabled = () => Boolean(API_KEY);

export class LlmError extends Error {}

export interface ToolCall<T extends z.ZodType> {
  system: string;
  user: string;
  name: string;
  description: string;
  schema: T;
  maxTokens?: number;
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
  if (!API_KEY) throw new LlmError("AI is not configured (missing LLM_API_KEY).");
  const raw = PROVIDER === "openai" ? await callOpenAI(call) : await callAnthropic(call);
  const parsed = call.schema.safeParse(raw.input);
  if (!parsed.success) {
    throw new LlmError(`The model's answer didn't match the expected format: ${parsed.error.issues[0]?.message ?? ""}`);
  }
  return { output: parsed.data, usage: { model: MODEL, ...raw.usage } };
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

async function callAnthropic(call: ToolCall<z.ZodType>): Promise<RawResult> {
  const data = await postJson(
    `${BASE_URL}/v1/messages`,
    { "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    {
      model: MODEL,
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

async function callOpenAI(call: ToolCall<z.ZodType>): Promise<RawResult> {
  const data = await postJson(
    `${BASE_URL}/chat/completions`,
    { authorization: `Bearer ${API_KEY}` },
    {
      model: MODEL,
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
