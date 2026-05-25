import { Actor, log } from "apify";
import { Dataset, PlaywrightCrawler } from "crawlee";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { createRandstadHandler, searchStartUrls } from "./routes.js";

type ActorInput = {
  mode?: "fixture" | "scrape";
  searchString?: string;
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
  const searchString = input.searchString ?? "";
  const maxItems = input.maxItems ?? 5000;

  // randstad.dk is likely an SPA; render with a real browser. Recon should
  // confirm whether a lighter Cheerio approach works (then swap the base image).
  const crawler = new PlaywrightCrawler({
    headless: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 300,
    requestHandler: createRandstadHandler({ maxItems }),
  });

  log.info(`scrape mode — searchString="${searchString}", maxItems=${maxItems}`);
  await crawler.run(searchStartUrls({ searchString }));
}

// Ship the dataset to the Sbotter webhook (?source=randstad) with an HMAC-SHA256
// signature over the raw body — identical to the Jobnet Actor.
const webhookUrl = process.env.SBOTTER_WEBHOOK_URL;
const webhookSecret = process.env.SBOTTER_WEBHOOK_SECRET;

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
    "SBOTTER_WEBHOOK_URL or SBOTTER_WEBHOOK_SECRET not set — skipping webhook.",
  );
}

await Actor.exit();
