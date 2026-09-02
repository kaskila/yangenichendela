import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Enables forbidden() / unauthorized() — used by the auth guards to render
    // a 403 for a signed-in user with the wrong role (vs. a redirect to
    // sign-in for someone not signed in at all).
    authInterrupts: true,
    serverActions: {
      // Cover-image uploads go through a server action; the default 1 MB body
      // limit is below a typical cover. Keep it modest — uploadCoverImage()
      // rejects anything over 5 MB itself.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
