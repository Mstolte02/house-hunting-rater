/**
 * Re-copy the Indiana Similarity snapshot out of the indiana-towns project.
 *
 * The housing app deliberately reads a *snapshot* under data/similarity/ rather than
 * reaching into ~/indiana-towns at runtime, so it keeps working if that project moves,
 * gets rebuilt, or is mid-pipeline-run. Run this when you re-run the indiana-towns
 * pipeline and want the new numbers here.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = join(HERE, "..", "data", "similarity");
const SRC =
  process.env.INDIANA_TOWNS_DATA ??
  join(homedir(), "indiana-towns", "web", "public", "data");

if (!existsSync(SRC)) {
  console.error(
    `No indiana-towns data at ${SRC}\n` +
      `Set INDIANA_TOWNS_DATA to the directory holding towns.json + meta.json.`
  );
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });
for (const f of ["towns.json", "meta.json"]) {
  copyFileSync(join(SRC, f), join(DEST, f));
  console.log(`copied ${f}`);
}
console.log(`Similarity snapshot refreshed from ${SRC}`);
