import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Better Auth's own endpoints (sign-in, sign-out, get-session, …). This is the
// third-party auth handler, not an internal API route — internal mutations use
// server actions per the architecture rules. Sign-up is disabled in the auth
// config, so POST /api/auth/sign-up/email returns 403.
export const { GET, POST } = toNextJsHandler(auth);
