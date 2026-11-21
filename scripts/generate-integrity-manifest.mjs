import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const rootDir = resolve(process.cwd());
const tauriDir = join(rootDir, "src-tauri");
const outPath = join(tauriDir, "resources", "integrity-manifest.json");

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function collectEntries(dirPath, category) {
  if (!existsSync(dirPath)) return [];
  const entries = [];
  for (const name of readdirSync(dirPath)) {
    const full = join(dirPath, name);
    const st = statSync(full);
    if (!st.isFile() || st.size <= 4096) continue;
    entries.push({
      fileName: basename(full),
      category,
      bytes: st.size,
      sha256: sha256File(full),
    });
  }
  return entries;
}

const files = [
  ...collectEntries(join(tauriDir, "binaries"), "sidecar"),
  ...collectEntries(join(tauriDir, "resources", "lib"), "library"),
  ...collectEntries(join(tauriDir, "resources", "tessdata"), "tessdata"),
  ...collectEntries(join(tauriDir, "resources", "icc"), "icc"),
];

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  algorithm: "sha256",
  files: Object.fromEntries(
    files.map((item) => [
      item.fileName,
      {
        category: item.category,
        bytes: item.bytes,
        sha256: item.sha256,
      },
    ])
  ),
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote SHA-256 integrity manifest (${files.length} entries) -> ${outPath}`);
