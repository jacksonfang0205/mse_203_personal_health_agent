import { chatAboutForm, FormChatRequest } from "@/lib/form/coach";
import { aiEnabled } from "@/lib/agent/llm";

export const maxDuration = 60;

/** Follow-up questions about a reviewed set. Needs the AI; there is no rule-based chat. */
export async function POST(request: Request) {
  const parsed = FormChatRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  if (!aiEnabled()) return Response.json({ error: "Follow-up questions need the AI, which isn't configured on this server." }, { status: 503 });
  try {
    return Response.json(await chatAboutForm(parsed.data));
  } catch (e) {
    console.error("form chat failed", e);
    return Response.json({ error: (e as Error).message || "The coach couldn't answer." }, { status: 502 });
  }
}
