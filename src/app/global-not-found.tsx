import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Next.js 16 (experimental.globalNotFound) — renders for URLs that match no
// route at all. Because our root layout sits under the dynamic [locale]
// segment, there is no shared layout to compose a 404 from, so this file must
// return a complete HTML document itself.

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "404 — Sbotter",
};

export default function GlobalNotFound() {
  return (
    <html
      lang="da"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Siden findes ikke
        </h1>
        <p className="text-muted-foreground max-w-md">
          Vi kunne ikke finde den side, du leder efter.
        </p>
        {/* Plain anchor on purpose: this document bypasses the router/layout. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
        >
          Til forsiden
        </a>
      </body>
    </html>
  );
}
