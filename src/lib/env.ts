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

/** Opt-in boolean flag: anything but an explicit "true" / "1" reads as false. */
function flag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
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
  get jobnetActorId() {
    // Apify Actor id (user~actor-name or the 17-char id) for the Jobnet
    // scraper. Optional: the scrape cron no-ops with a log line when it's
    // unset, so the app boots and deploys before the Actor is pushed.
    return optional(process.env.JOBNET_ACTOR_ID);
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
    // Legacy: cvrapi.dk's token. The CVR enrichment pass now runs on
    // cvrlookup.dk (see cvrLookupApiKey) and no longer reads this. Kept so
    // deployments that still set it don't break; safe to delete from Vercel.
    return optional(process.env.CVRAPI_TOKEN);
  },
  get cvrLookupApiKey() {
    // cvrlookup.dk API key ("cvr_..."), sent as a Bearer token. Optional so the
    // app boots without it: the CVR pass logs and skips instead of failing the
    // whole enrichment batch.
    return optional(process.env.CVRLOOKUP_API_KEY);
  },
  get anthropicApiKey() {
    // Optional: Pass 4 (AI phone lookup) logs and skips when it's missing,
    // rather than failing the whole enrichment batch.
    return optional(process.env.ANTHROPIC_API_KEY);
  },
  get enableAiEnrichment() {
    // Kill switch for Pass 4. OFF unless explicitly set to "true": every lookup
    // runs billed web searches on top of Opus tokens, and the layer is worth
    // its cost only in bursts. Off means no Anthropic call is made at all —
    // the code stays in place so it can be switched back on.
    return flag(process.env.ENABLE_AI_ENRICHMENT);
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
