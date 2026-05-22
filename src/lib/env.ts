function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. Add it to .env.local.`,
    );
  }
  return value;
}

function optional(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  get supabaseServiceRoleKey() {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get apifyToken() {
    return optional(process.env.APIFY_TOKEN);
  },
  get apifyWebhookSecret() {
    return required("APIFY_WEBHOOK_SECRET", process.env.APIFY_WEBHOOK_SECRET);
  },
  get apifyWebhookToken() {
    // Static bearer token Apify sends via Authorization header (it can't compute
    // our HMAC). Optional: the ingest route also accepts an x-sbotter-signature.
    return optional(process.env.APIFY_WEBHOOK_TOKEN);
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  },
};
