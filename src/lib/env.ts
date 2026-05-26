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
  get apifyTokenRequired() {
    // Same token as apifyToken, but required: starting an Actor run via the Apify
    // API (e.g. the Krak enricher) can't work without it. Stays a separate getter
    // so the app boots without APIFY_TOKEN when no run is being started.
    return required("APIFY_TOKEN", process.env.APIFY_TOKEN);
  },
  get krakEnricherActorId() {
    // Apify Actor id (user~actor-name or the 17-char id) for the Krak.dk enricher.
    // Required to start a "Find phone numbers" run; optional so the app boots.
    return optional(process.env.KRAK_ENRICHER_ACTOR_ID);
  },
  get apifyWebhookSecret() {
    return required("APIFY_WEBHOOK_SECRET", process.env.APIFY_WEBHOOK_SECRET);
  },
  get apifyWebhookToken() {
    // Static bearer token Apify sends via Authorization header (it can't compute
    // our HMAC). Optional: the ingest route also accepts an x-sbotter-signature.
    return optional(process.env.APIFY_WEBHOOK_TOKEN);
  },
  get cvrApiToken() {
    // Optional. Removes the 50/day cvrapi.dk rate limit (HTTP Basic auth).
    return optional(process.env.CVRAPI_TOKEN);
  },
  get cronSecret() {
    // Bearer secret Vercel Cron sends in the Authorization header. Optional here;
    // the cron route refuses to run if it's not configured.
    return optional(process.env.CRON_SECRET);
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  },
};
