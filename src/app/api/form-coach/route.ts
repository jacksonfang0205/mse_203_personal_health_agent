import { coachForm, FormCoachRequest } from "@/lib/form/coach";

export const maxDuration = 60;

/**
 * Form coach. The browser runs pose estimation and sends keypoints only, never
 * the video. Works without an API key (rule-based coach), and says which one ran.
 */
export async function POST(request: Request) {
  const parsed = FormCoachRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  try {
    return Response.json(await coachForm(parsed.data));
  } catch (e) {
    console.error("form coach failed", e);
    return Response.json({ error: (e as Error).message || "The form coach failed." }, { status: 500 });
  }
}
