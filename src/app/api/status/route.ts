import { connection } from "next/server";
import { authConfigured } from "@/auth";
import { aiEnabled, modelName } from "@/lib/agent/llm";

/** Lets the client know whether live AI and accounts are configured. Never exposes keys. */
export async function GET() {
  await connection(); // read env at request time, not at build
  return Response.json({ ai: aiEnabled(), model: aiEnabled() ? modelName() : null, accounts: authConfigured() });
}
