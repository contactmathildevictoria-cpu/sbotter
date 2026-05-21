import { Actor, log } from "apify";
import { CheerioCrawler, Dataset } from "crawlee";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { router } from "./routes.js";

type ActorInput = {
  mode?: "fixture" | "scrape";
  startUrls?: Array<{ url: string }>;
  maxItems?: number;
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
  const startUrls = input.startUrls?.map((u) => u.url) ?? [
    "https://job.jobnet.dk/CV/FindWork/Search?SortValue=BestMatch",
  ];
  const crawler = new CheerioCrawler({
    requestHandler: router,
    maxRequestsPerCrawl: input.maxItems ?? 100,
  });
  log.info(`scrape mode — starting from ${startUrls.length} URL(s)`);
  await crawler.run(startUrls);
}

// Ship the dataset to the Spotter webhook if WEBHOOK_URL is configured.
// This lets us bypass Apify's built-in webhooks entirely and keep signing
// inside the Actor itself — useful for local apify-cli runs.
const webhookUrl = process.env.SPOTTER_WEBHOOK_URL;
const webhookSecret = process.env.SPOTTER_WEBHOOK_SECRET;

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
      "x-spotter-signature": signature,
    },
    body,
  });
  log.info(`webhook responded ${res.status}`);
  if (!res.ok) {
    log.error(`webhook body: ${await res.text()}`);
  }
} else {
  log.info(
    "SPOTTER_WEBHOOK_URL or SPOTTER_WEBHOOK_SECRET not set — skipping webhook.",
  );
}

await Actor.exit();
