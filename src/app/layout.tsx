import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Geist is a PLACEHOLDER (see globals.css) — not the brand faces, which use a
// heavy display sans and a script accent. Self-hosted at build, no runtime
// request. The variable font is one file covering every weight.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Site-wide fallback only. The (marketing) layout sets the real defaults,
// template and Open Graph for the public pages; (shop) and (admin) pages set
// their own titles. Kept template-free here so a child's explicit
// "… — Yangeni Chendela" title is not double-suffixed.
export const metadata: Metadata = {
  title: "Yangeni Chendela",
  description:
    "Author, speaking and advisory site for Yangeni Chendela — HR director and " +
    "author of Become Unstoppable and Level Up.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
