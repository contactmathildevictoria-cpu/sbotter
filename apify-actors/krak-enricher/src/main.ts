import { Actor, log } from "apify";
import { Dataset, PlaywrightCrawler } from "crawlee";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import type { KrakCompanyInput } from "./shared/types.js";
import { createKrakLookupHandler, lookupStartRequests } from "./routes.js";

type ActorInput = {
  mode?: "fixture" | "scrape";
  companies?: KrakCompanyInput[];
  maxItems?: number;
  webhookUrl?: string;
  webhookSecret?: string;
};

const MAX_COMPANIES = 100;

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? {};
const mode = input.mode ?? "fixture";

if (mode === "fixture") {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(here, "..", "fixtures", "sample-results.json");
  const text = await readFile(fixturePath, "utf-8");
  const items = JSON.parse(text) as unknown[];
  log.info(`fixture mode — pushing ${items.length} results`);
  await Dataset.pushData(items);
} else {
  const companies = (input.companies ?? []).slice(0, input.maxItems ?? MAX_COMPANIES);
  if (companies.length > MAX_COMPANIES) {
    throw new Error(`Too many companies: ${companies.length} (max ${MAX_COMPANIES}).`);
  }

  // Krak.dk puts its company search behind Cloudflare (Turnstile managed
  // challenge) — plain/datacenter requests get a 403 "Just a moment…" page that
  // never clears. Passing it reliably needs a real browser + realistic
  // fingerprints + a Danish RESIDENTIAL proxy. We run one company at a time
  // (maxConcurrency 1) with a 2s pause between each (in the handler). The handler
  // detects an unsolved challenge and records a skip rather than scraping junk.
  const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ["RESIDENTIAL"],
    countryCode: "DK",
  });
  const crawler = new PlaywrightCrawler({
    headless: true,
    proxyConfiguration,
    browserPoolOptions: { useFingerprints: true },
    maxConcurrency: 1,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
    requestHandler: createKrakLookupHandler(),
  });

  log.info(`scrape mode — looking up ${companies.length} companies on krak.dk`);
  await crawler.run(lookupStartRequests(companies));
}

// Ship the per-company results to the Sbotter Krak webhook. The actor-level env
// vars take precedence (set SBOTTER_WEBHOOK_URL to the production URL on the
// Apify actor — that's the source of truth and survives a misconfigured caller),
// then fall back to the run input (used for local `apify run` testing). This
// avoids the failure mode where Sbotter's NEXT_PUBLIC_APP_URL defaults to
// http://localhost:3000 and the actor would otherwise POST results into the void.
const webhookUrl = process.env.SBOTTER_WEBHOOK_URL || input.webhookUrl;
const webhookSecret = process.env.SBOTTER_WEBHOOK_SECRET || input.webhookSecret;

if (webhookUrl && webhookSecret) {
  const dataset = await Dataset.open();
  const { items } = await dataset.getData();
  const body = JSON.stringify({
    eventType: "ACTOR.RUN.SUCCEEDED",
    resource: {
      id: process.env.APIFY_ACTOR_RUN_ID,
      actId: process.env.APIFY_ACTOR_ID,
    },
    items,
  });
  const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
  log.info(`POSTing ${items.length} results to ${webhookUrl}`);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sbotter-signature": signature,
    },
    body,
  });
  log.info(`webhook responded ${res.status}`);
  if (!res.ok) {
    log.error(`webhook body: ${await res.text()}`);
  }
} else {
  log.info(
    "No webhook URL/secret (input or SBOTTER_WEBHOOK_URL / SBOTTER_WEBHOOK_SECRET) — skipping webhook.",
  );
}

await Actor.exit();
