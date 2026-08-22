import "server-only";

import { betterAuth } from "better-auth";
import { db } from "@/lib/db";
import { buildAuthOptions } from "@/lib/auth-options";

export const auth = betterAuth(buildAuthOptions(db));

export type AuthSession = typeof auth.$Infer.Session;
