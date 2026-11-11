import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { authConfigured } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

const SignUp = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
  name: z.string().trim().max(60).optional(),
});

/** Create an email/password account. The client then signs in with the same details. */
export async function POST(request: Request) {
  await connection();
  if (!authConfigured()) return Response.json({ error: "Accounts aren't set up." }, { status: 501 });
  const parsed = SignUp.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid details." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();

  const [existing] = await db().select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email));
  if (existing) {
    const error = existing.passwordHash
      ? "An account with this email already exists. Sign in instead."
      : "This email already signs in with Google. Use Continue with Google.";
    return Response.json({ error }, { status: 409 });
  }

  await db()
    .insert(users)
    .values({ email, name: parsed.data.name || null, passwordHash: await bcrypt.hash(parsed.data.password, 12) });
  return Response.json({ ok: true }, { status: 201 });
}
