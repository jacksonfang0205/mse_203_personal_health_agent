import { AgentRequest } from "@/lib/agent/context";
import { aiEnabled } from "@/lib/agent/llm";
import { agentPlanWeek, templatePlanWeek } from "@/lib/agent/plan";

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = AgentRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const req = parsed.data;
  if (!aiEnabled()) return Response.json(templatePlanWeek(req, "AI isn't configured, so this is a template plan."));
  try {
    const result = await agentPlanWeek(req);
    // An empty AI plan when the template can find time means something went wrong; prefer the template.
    if (!result.plan.workouts.some((w) => w.origin === "agent") && req.profile.frequencyPerWeek > 0) {
      const template = templatePlanWeek(req, "The AI couldn't place any sessions, so this is a template plan.");
      if (template.plan.workouts.length) return Response.json(template);
    }
    return Response.json(result);
  } catch (e) {
    console.error("plan agent failed", e);
    return Response.json(templatePlanWeek(req, `AI planning failed (${(e as Error).message}). This is a template plan.`));
  }
}
