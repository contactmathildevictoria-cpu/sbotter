import { Actor, log } from "apify";
import { Dataset, PlaywrightCrawler } from "crawlee";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { createJobnetSearchHandler } from "./routes.js";

type ActorInput = {
  mode?: "fixture" | "scrape";
  searchString?: string;
  maxItems?: number;
  orderType?: string;
  /** Where to POST the dataset. Overrides SBOTTER_WEBHOOK_URL. */
  webhookUrl?: string;
  /** HMAC key for the x-sbotter-signature header. Overrides SBOTTER_WEBHOOK_SECRET. */
  webhookSecret?: string;
};

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? {};
const mode = input.mode ?? "fixture";

if (mode === "fixture") {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(here, "..", "fixtures", "sample-items.json");
  const text = await readFile(fixturePath, "utf-8");
  const items = JSON.parse(text) as unknown[];
  log.info(`fixture mode — pushing ${items.length} items`);
  await Dataset.pushData(items);
} else {
  const searchString = input.searchString ?? "";
  const maxItems = input.maxItems ?? 100;
  const orderType = input.orderType ?? "BestMatch";

  // Jobnet.dk is a Relay SPA whose job data comes from a session-gated JSON BFF.
  // We render /find-job once with a real browser to obtain the session, then the
  // handler calls the BFF directly and paginates. See src/routes.ts.
  const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 300,
    requestHandler: createJobnetSearchHandler({ searchString, maxItems, orderType }),
  });

  log.info(
    `scrape mode — searchString="${searchString}", maxItems=${maxItems}, orderType=${orderType}`,
  );
  await crawler.run([
    { url: "https://jobnet.dk/find-job", label: "SEARCH" },
  ]);
}

// Ship the dataset to the Sbotter webhook. This bypasses Apify's built-in
// webhooks entirely and keeps signing inside the Actor — which is also what
// makes local apify-cli runs work.
//
// Input first, then env. Input-first is what lets
// the scrape cron (src/lib/scrape.ts) pass the URL and secret per run, so the
// secret lives only in Vercel and can be rotated there without touching the
// Actor's saved configuration. The env vars remain the fallback for local runs.
const webhookUrl = input.webhookUrl ?? process.env.SBOTTER_WEBHOOK_URL;
const webhookSecret = input.webhookSecret ?? process.env.SBOTTER_WEBHOOK_SECRET;

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
  log.info(`POSTing ${items.length} items to ${webhookUrl}`);
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
    "No webhook URL/secret in input or env (webhookUrl/webhookSecret, " +
      "SBOTTER_WEBHOOK_URL/SBOTTER_WEBHOOK_SECRET) — skipping webhook.",
  );
}

await Actor.exit();
