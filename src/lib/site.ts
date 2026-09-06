// Site-wide constants for the public (marketing) pages. The confirmed site name
// is "Yangeni Chendela" (CLAUDE.md). Contact details were supplied by the client
// team — they are not in docs/client-facts.md yet and should be added there.
//
// The existing book pages keep their own local SITE_NAME/BASE_URL; this module
// is for the pages added in build-order item 11 and after.

export const SITE = {
  name: "Yangeni Chendela",
  /** Absolute base for canonical URLs, Open Graph and JSON-LD. */
  baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  location: "Lusaka, Zambia",
  socials: {
    linkedin: "https://www.linkedin.com/in/yangeni-chendela-aa2a29a5/",
    facebook: "https://www.facebook.com/p/Yangeni-Chendela-100075468894508/",
    email: "cyangeni@gmail.com",
  },
} as const;
