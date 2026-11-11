import type { NextRequest } from "next/server";
import { authConfigured, handlers } from "@/auth";

// Until accounts are configured, answer plainly instead of letting Auth.js throw MissingSecret.
const off = () => Response.json({ error: "Accounts aren't set up." }, { status: 404 });

export const GET = (req: NextRequest) => (authConfigured() ? handlers.GET(req) : off());
export const POST = (req: NextRequest) => (authConfigured() ? handlers.POST(req) : off());
