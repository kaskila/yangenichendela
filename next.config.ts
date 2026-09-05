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
      // Cover images are 5 MB max; ebook PDFs (uploadEbookFile) are 9 MB max
      // — verified live against this Cloudinary account, whose raw-resource
      // uploads reject anything over ~10 MB regardless of what's configured
      // here. 14 MB gives headroom for base64 upload inflation (~33%) plus
      // multipart overhead. NOTE: if this deploys on Vercel, serverless
      // functions enforce their own ~4.5 MB request/response body ceiling
      // regardless of this setting — this config can't override a platform
      // limit.
      bodySizeLimit: "14mb",
    },
  },
};

export default nextConfig;
