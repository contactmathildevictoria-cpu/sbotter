import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Lets us define a full-document 404 for routes that match nothing at all.
    // Required because our only root layout lives under the [locale] segment.
    globalNotFound: true,
  },
};

export default withNextIntl(nextConfig);
