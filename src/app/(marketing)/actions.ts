"use server";

import { redirect } from "next/navigation";
import { subscribeToNewsletter } from "@/lib/services/newsletter";

// PUBLIC BY DESIGN. No requireAdmin()/requireStaff() — this is the homepage
// newsletter form and visitors are not signed in. subscribeToNewsletter() does
// all validation. Do not "fix" this by adding an auth guard.
//
// Plain form action (FormData -> redirect), not a useActionState reducer, so the
// homepage stays a pure Server Component with zero client JavaScript. The
// outcome is carried back in a query param and shown as a flash message.

export async function subscribeAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const result = await subscribeToNewsletter({
    email: typeof email === "string" ? email : "",
    source: "homepage",
  });

  redirect(result.ok ? "/?subscribed=1#keep-in-touch" : "/?subscribed=err#keep-in-touch");
}
