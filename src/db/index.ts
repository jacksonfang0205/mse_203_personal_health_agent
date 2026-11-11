/**
 * Database client. Server-side only. Neon's HTTP driver needs no connection
 * pool, which suits serverless routes on Vercel.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

let client: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** The Drizzle client. Throws if DATABASE_URL isn't set, so callers should check `dbConfigured()` first. */
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  client ??= drizzle(neon(process.env.DATABASE_URL), { schema });
  return client;
}
