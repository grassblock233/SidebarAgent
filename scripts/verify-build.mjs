import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve("dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));

const requiredFiles = new Set([
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
].filter(Boolean));

for (const file of requiredFiles) await access(resolve(dist, file));

if (manifest.manifest_version !== 3 || manifest.version !== "0.7.0") {
  throw new Error("Built manifest does not match the expected MV3 release contract.");
}

console.log(`Verified ${requiredFiles.size} extension build artifacts.`);
