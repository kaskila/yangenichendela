"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireStaff } from "@/lib/auth/guards";

export async function signOutAction() {
  // Only a signed-in operator can sign out; also stops this being a blind
  // public endpoint.
  await requireStaff();
  await auth.api.signOut({ headers: await headers() });
  redirect("/admin/login");
}
