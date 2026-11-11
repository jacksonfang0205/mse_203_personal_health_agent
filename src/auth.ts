/**
 * Google sign-in (Auth.js) with read-only Google Calendar access.
 *
 * Needs AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and DATABASE_URL in
 * .env.local (and in Vercel). Without them the app runs exactly as before,
 * on this device only, and the sign-in button stays hidden.
 *
 * Google tokens are stored in the `account` table by the Drizzle adapter and
 * read on the server by /api/calendar. They never reach the browser.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export const authConfigured = () =>
  Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.DATABASE_URL);

// Config is built per request, so nothing touches the database until auth is actually used.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: authConfigured()
    ? DrizzleAdapter(db(), { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens })
    : undefined,
  session: { strategy: authConfigured() ? "database" : "jwt" },
  providers: [
    Google({
      authorization: {
        params: {
          scope: `openid email profile ${CALENDAR_SCOPE}`,
          // offline + consent so Google returns a refresh token for later calendar reads.
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
}));
