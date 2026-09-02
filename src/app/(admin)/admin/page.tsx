import { requireAdmin } from "@/lib/auth/guards";
import { signOutAction } from "./actions";

// Throwaway page. It exists to prove the auth seam end to end: requireAdmin()
// gates it, and it shows who is signed in. Real admin screens replace this.
export default async function AdminHome() {
  const user = await requireAdmin();

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Admin</h1>
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>{user.role}</dd>
      </dl>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
