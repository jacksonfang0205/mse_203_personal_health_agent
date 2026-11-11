/**
 * Sign-in (Auth.js): email and password, or Google. Google sign-in asks only for name and email; read-only
 * Google Calendar access is requested later, only when the user imports their
 * calendar (incremental authorization), so sign-in needs no sensitive scope.
 *
 * Needs AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and DATABASE_URL in
 * .env.local (and in Vercel). Without them the app runs exactly as before,
 * on this device only, and the sign-in button stays hidden.
 *
 * Google tokens are stored in the `account` table by the Drizzle adapter and
 * read on the server by /api/calendar. They never reach the browser.
 *
 * Sessions are JWTs (the Credentials provider requires it). A Google sign-in while
 * already signed in links that Google account to the current user, which is how an
 * email/password user connects Google just for calendar access.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const BASIC_SCOPES = "openid email profile";

export const authConfigured = () =>
  Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.DATABASE_URL);

// Config is built per request, so nothing touches the database until auth is actually used.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: authConfigured()
    ? DrizzleAdapter(db(), { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens })
    : undefined,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const email = String(raw?.email ?? "").trim().toLowerCase();
        const password = String(raw?.password ?? "");
        if (!authConfigured() || !email || !password) return null;
        const [user] = await db().select().from(users).where(eq(users.email, email));
        // Same answer for "no such email" and "wrong password", so emails can't be probed.
        if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return null;
        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
    Google({
      authorization: {
        params: {
          scope: BASIC_SCOPES,
          // Calendar access is added later with include_granted_scopes (see importGoogleCalendar).
          include_granted_scopes: "true",
        },
      },
    }),
  ],
  callbacks: {
    // JWT sessions: carry the user id so server routes can find the user's data.
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    // Auth.js only stores tokens when an account is first linked. When a user signs in again,
    // e.g. to grant calendar access, save the new tokens and scopes so the import can use them.
    async signIn({ account }) {
      if (!authConfigured() || account?.provider !== "google" || !account.access_token) return;
      await db()
        .update(accounts)
        .set({
          access_token: account.access_token,
          expires_at: account.expires_at ?? null,
          scope: account.scope ?? null,
          id_token: account.id_token ?? null,
          ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
        })
        .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, account.providerAccountId)));
    },
  },
}));
