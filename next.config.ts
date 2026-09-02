import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Enables forbidden() / unauthorized() — used by the auth guards to render
    // a 403 for a signed-in user with the wrong role (vs. a redirect to
    // sign-in for someone not signed in at all).
    authInterrupts: true,
  },
};

export default nextConfig;
