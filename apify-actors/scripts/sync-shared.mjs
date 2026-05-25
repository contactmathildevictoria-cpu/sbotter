#!/usr/bin/env node
// Copy apify-actors/shared/src/* into each <actor>/src/shared/.
//
// Why copy instead of import "../shared"? Each Actor's .actor/Dockerfile uses its
// OWN directory as the Docker build context, so a parent-dir import would never
// be COPYd into the image and `apify push` would fail. Vendoring the shared
// files into src/shared/ (committed) keeps a single source of truth while letting
// the unchanged `COPY . ./` pick them up. Run after editing shared/src/*.
import { readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharedSrc = join(root, "shared", "src");

// Every dir under apify-actors/ that has a src/ folder, except `shared` itself.
const actors = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "shared" && d.name !== "scripts")
  .map((d) => d.name)
  .filter((name) => {
    try {
      return statSync(join(root, name, "src")).isDirectory();
    } catch {
      return false;
    }
  });

const files = readdirSync(sharedSrc).filter((f) => f.endsWith(".ts"));

for (const actor of actors) {
  const dest = join(root, actor, "src", "shared");
  mkdirSync(dest, { recursive: true });
  for (const file of files) {
    copyFileSync(join(sharedSrc, file), join(dest, file));
  }
  console.log(`synced ${files.length} file(s) → ${actor}/src/shared/`);
}

console.log(`done — ${actors.length} actor(s) updated.`);
