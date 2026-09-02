import Link from "next/link";

// Rendered when a guard calls forbidden() — a signed-in user whose role does
// not permit the area they asked for. Plain markup; brand assets have not
// arrived.
export default function Forbidden() {
  return (
    <main style={{ padding: "2rem", maxWidth: "32rem" }}>
      <h1>You don&rsquo;t have access to this area</h1>
      <p>
        Your account is signed in but is not permitted here. If this is wrong,
        ask an administrator to check your role.
      </p>
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
