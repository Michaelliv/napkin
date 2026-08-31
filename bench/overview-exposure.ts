/**
 * Index-exposure scorer for `napkin overview` keywords.
 *
 * Scores the keywords the real overview pipeline selected, per folder row,
 * against the vault's own search ranking:
 *   - precision: share of a keyword's top results (window = min(10,
 *     2×folder size, ≥4)) that land inside its folder
 *   - coverage: share of the folder's notes reached by at least one keyword
 *
 * Direct queries only — a deliberately blunt external metric for regression
 * tracking, independent of the selection heuristics inside the pipeline.
 *
 * Usage: bun bench/overview-exposure.ts <vault-path>
 */
import { loadSearchCorpus } from "../src/core/search.js";
import { Napkin } from "../src/sdk.js";

const vaultPath = process.argv[2] || process.cwd();

const n = new Napkin(vaultPath);
const { overview } = n.overview();
const corpus = loadSearchCorpus(n.vault.contentPath, n.vault.configPath);

const PROBE_K = 10;

const inFolder = (file: string, folder: string): boolean =>
  folder === "/" ? !file.includes("/") : file.startsWith(`${folder}/`);

interface Row {
  folder: string;
  notes: number;
  keywords: number;
  precision: number;
  coverage: number;
}

const rows: Row[] = [];
for (const f of overview) {
  if (f.keywords.length === 0) continue;

  const window = Math.min(PROBE_K, Math.max(4, f.notes * 2));
  let precisionSum = 0;
  const covered = new Set<string>();

  for (const kw of f.keywords) {
    const top = corpus
      .rank(kw)
      .slice(0, window)
      .map((r) => r.file);
    const hits = top.filter((file) => inFolder(file, f.path));
    precisionSum += top.length > 0 ? hits.length / top.length : 0;
    for (const h of hits) covered.add(h);
  }

  rows.push({
    folder: f.path,
    notes: f.notes,
    keywords: f.keywords.length,
    precision: precisionSum / f.keywords.length,
    coverage: Math.min(1, covered.size / f.notes),
  });
}

const pad = (s: string, w: number) => s.padEnd(w);
console.log(`${pad("folder", 44)}${pad("notes", 7)}${pad("prec", 7)}cov`);
for (const r of [...rows].sort((a, b) => b.notes - a.notes)) {
  console.log(
    `${pad(r.folder, 44)}${pad(String(r.notes), 7)}${pad(r.precision.toFixed(2), 7)}${r.coverage.toFixed(2)}`,
  );
}

const mean = (f: (r: Row) => number) =>
  rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
const wMean = (f: (r: Row) => number) => {
  const tw = rows.reduce((a, r) => a + r.notes, 0);
  return rows.reduce((a, r) => a + f(r) * r.notes, 0) / Math.max(1, tw);
};

console.log("");
console.log(
  `folders: ${rows.length}  precision mean=${mean((r) => r.precision).toFixed(3)} weighted=${wMean((r) => r.precision).toFixed(3)}  coverage mean=${mean((r) => r.coverage).toFixed(3)} weighted=${wMean((r) => r.coverage).toFixed(3)}`,
);
