import { requireAdmin } from "@/lib/auth/guards";

// Deliberate stub. The order queue is build-order item 8; this page only exists
// so the nav item points somewhere.
export default async function AdminOrdersStub() {
  await requireAdmin();

  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">Orders</h1>
      <p className="text-sm text-admin-ink-muted">Nothing here yet.</p>
    </div>
  );
}
