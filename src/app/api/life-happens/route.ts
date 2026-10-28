import { z } from "zod";
import { AgentRequest } from "@/lib/agent/context";
import { agentLifeHappens } from "@/lib/agent/lifeHappens";
import { aiEnabled } from "@/lib/agent/llm";

export const maxDuration = 60;

const Body = AgentRequest.extend({ message: z.string().trim().min(1).max(500) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  if (!aiEnabled()) return Response.json({ error: "AI isn't configured on this server." }, { status: 503 });
  try {
    return Response.json(await agentLifeHappens(parsed.data));
  } catch (e) {
    console.error("life-happens agent failed", e);
    return Response.json({ error: (e as Error).message || "The AI request failed." }, { status: 502 });
  }
}
