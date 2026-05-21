// Root layout intentionally minimal — the locale-aware <html>/<body> live
// in src/app/[locale]/layout.tsx. next-intl's middleware rewrites all
// non-locale-prefixed paths to the default locale, so requests never resolve
// against this layout alone.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
