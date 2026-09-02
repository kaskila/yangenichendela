import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/guards";

// Every route in the (admin) group is admin-only. This layout is a backstop,
// not the protection itself — each admin server action must still call
// requireAdmin() / requireStaff() on its own.
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin();
  return children;
}
