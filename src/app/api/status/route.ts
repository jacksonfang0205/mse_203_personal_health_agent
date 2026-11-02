import { connection } from "next/server";
import { aiEnabled, modelName } from "@/lib/agent/llm";

/** Lets the client know whether live AI is configured. Never exposes the key. */
export async function GET() {
  await connection(); // read env at request time, not at build
  return Response.json({ ai: aiEnabled(), model: aiEnabled() ? modelName() : null });
}
