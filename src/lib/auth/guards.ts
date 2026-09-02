import "server-only";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { auth, type SessionUser } from "@/lib/auth";

// The authorisation seam. Every admin server action and every protected page /
// layout calls one of these first. Middleware is not a substitute — an
// unprotected server action is a public endpoint regardless of the UI.
//
// Not signed in           -> redirect to the sign-in page (never returns).
// Signed in, wrong role    -> forbidden() renders a 403 (never returns).
// Signed in, allowed role  -> returns the session user.

const SIGN_IN_PATH = "/admin/login";

async function currentUser(): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect(SIGN_IN_PATH);
  }
  return session.user;
}

/** Any operator account. Allows STAFF and ADMIN; denies anything else. */
export async function requireStaff(): Promise<SessionUser> {
  const user = await currentUser();
  if (user.role !== "ADMIN" && user.role !== "STAFF") {
    forbidden();
  }
  return user;
}

/** ADMIN only. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await currentUser();
  if (user.role !== "ADMIN") {
    forbidden();
  }
  return user;
}
