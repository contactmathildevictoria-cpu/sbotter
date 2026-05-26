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

  // Krak.dk blocks plain HTTP with 403, so we render with a real browser. One
  // company at a time (maxConcurrency 1) with a 2s pause between each (handled in
  // the handler) to avoid being blocked. See src/routes.ts.
  const crawler = new PlaywrightCrawler({
    headless: true,
    maxConcurrency: 1,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    requestHandler: createKrakLookupHandler(),
  });

  log.info(`scrape mode — looking up ${companies.length} companies on krak.dk`);
  await crawler.run(lookupStartRequests(companies));
}

// Ship the per-company results to the Sbotter Krak webhook. URL/secret come from
// the run input first (Sbotter passes them when starting the run), then fall back
// to env vars — identical signing to the job-scraping Actors.
const webhookUrl = input.webhookUrl || process.env.SBOTTER_WEBHOOK_URL;
const webhookSecret = input.webhookSecret || process.env.SBOTTER_WEBHOOK_SECRET;

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
