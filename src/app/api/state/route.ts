import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { auth, authConfigured } from "@/auth";
import { db } from "@/db";
import { userState } from "@/db/schema";
import { AppState } from "@/lib/appState";

/** The signed-in user's saved Pivot state. 204 when nothing is saved yet. */
export async function GET() {
  await connection();
  if (!authConfigured()) return Response.json({ error: "Accounts aren't set up." }, { status: 501 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not signed in." }, { status: 401 });
  const [row] = await db().select().from(userState).where(eq(userState.userId, session.user.id));
  if (!row) return new Response(null, { status: 204 });
  const parsed = AppState.safeParse(row.state);
  return parsed.success ? Response.json(parsed.data) : new Response(null, { status: 204 });
}

/** Save the user's state. The body is validated with the same schema the browser uses. */
export async function PUT(request: Request) {
  await connection();
  if (!authConfigured()) return Response.json({ error: "Accounts aren't set up." }, { status: 501 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not signed in." }, { status: 401 });
  const text = await request.text();
  if (text.length > 1_000_000) return Response.json({ error: "Too large." }, { status: 413 });
  const parsed = AppState.safeParse(JSON.parse(text || "null"));
  if (!parsed.success) return Response.json({ error: "Invalid state." }, { status: 400 });
  const updatedAt = new Date();
  await db()
    .insert(userState)
    .values({ userId: session.user.id, state: parsed.data, updatedAt })
    .onConflictDoUpdate({ target: userState.userId, set: { state: parsed.data, updatedAt } });
  return Response.json({ ok: true, updatedAt });
}
