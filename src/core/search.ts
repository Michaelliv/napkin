import * as fs from "node:fs";
import * as path from "node:path";
import { FerroSearch } from "@shift-labs/ferrosearch";
import { loadConfig } from "../utils/config.js";
import { buildLinkResolver, listFiles } from "../utils/files.js";
import { computeFingerprint } from "../utils/fingerprint.js";
import { extractLinks } from "../utils/markdown.js";
import { loadSearchCache, saveSearchCache } from "../utils/search-cache.js";

export interface SearchResult {
  file: string;
  score: number;
  links: number;
  modified: string;
  snippets: { line: number; text: string }[];
}

export interface SearchOptions {
  path?: string;
  limit?: number;
  snippetLines?: number;
  snippets?: boolean;
}

interface DocRecord {
  id: number;
  file: string;
  basename: string;
  content: string;
  mtime: number;
}

/** The shape of one search hit; ferrosearch types results as `unknown`. */
interface IndexHit {
  id: number;
  score: number;
}

// Shared by indexing and cache loading: loadJson requires the exact options
// the index was serialized with, so there must be a single definition.
const INDEX_OPTIONS = {
  fields: ["basename", "content"],
  storeFields: ["file"],
  searchOptions: {
    boost: { basename: 2 },
    fuzzy: 0.2,
    prefix: true,
  },
};

function buildIndex(vaultPath: string, folder?: string) {
  const files = listFiles(vaultPath, { folder, ext: "md" });

  const docs: DocRecord[] = files.map((file, id) => {
    const fullPath = path.join(vaultPath, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    const stat = fs.statSync(fullPath);
    const basename = path.basename(file, ".md");
    return { id, file, basename, content, mtime: stat.mtimeMs };
  });

  const index = new FerroSearch(INDEX_OPTIONS);
  index.addAll(docs);
  return { index, docs };
}

function buildBacklinkCounts(vaultPath: string): Map<string, number> {
  const files = listFiles(vaultPath, { ext: "md" });
  const resolve = buildLinkResolver(files);
  const counts = new Map<string, number>();

  for (const file of files) {
    const content = fs.readFileSync(path.join(vaultPath, file), "utf-8");
    const links = extractLinks(content);
    for (const target of links.wikilinks) {
      const resolved = resolve(target);
      if (resolved) {
        counts.set(resolved, (counts.get(resolved) || 0) + 1);
      }
    }
  }

  return counts;
}

function extractSnippets(
  content: string,
  query: string,
  contextLines: number,
): { line: number; text: string }[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const lines = content.split("\n");
  const matchedLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      matchedLines.add(i);
    }
  }

  const ranges: [number, number][] = [];
  for (const lineIdx of [...matchedLines].sort((a, b) => a - b)) {
    const start = Math.max(0, lineIdx - contextLines);
    const end = Math.min(lines.length - 1, lineIdx + contextLines);
    if (ranges.length > 0 && start <= ranges[ranges.length - 1][1] + 1) {
      ranges[ranges.length - 1][1] = end;
    } else {
      ranges.push([start, end]);
    }
  }

  const snippets: { line: number; text: string }[] = [];
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      snippets.push({ line: i + 1, text: line });
    }
  }

  return snippets;
}

function relativeTime(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export interface RankedHit {
  file: string;
  /** Composite relevance: BM25 + log₂(1+backlinks) + recency, rounded to 0.1. */
  score: number;
  links: number;
  mtime: number;
  content: string;
}

export interface SearchCorpus {
  rank(query: string): RankedHit[];
}

/**
 * The vault's ranked search corpus — the index, documents, and backlink
 * counts behind every relevance judgement, loaded from the search cache or
 * built and saved. `searchVault` and the overview keyword probes share it so
 * their notion of "what this query returns" can never disagree.
 */
export function loadSearchCorpus(
  contentPath: string,
  configPath: string,
  folder?: string,
): SearchCorpus {
  const fingerprint = computeFingerprint(contentPath, folder);
  const cached = loadSearchCache(configPath, fingerprint);

  let index: FerroSearch;
  let docs: DocRecord[];
  let backlinkCounts: Map<string, number>;

  if (cached) {
    index = FerroSearch.loadJson(cached.index, INDEX_OPTIONS);
    docs = cached.docs.map((d) => {
      const fullPath = path.join(contentPath, d.file);
      const content = fs.readFileSync(fullPath, "utf-8");
      return { ...d, content };
    });
    backlinkCounts = new Map(Object.entries(cached.backlinkCounts));
  } else {
    const built = buildIndex(contentPath, folder);
    index = built.index;
    docs = built.docs;
    backlinkCounts = buildBacklinkCounts(contentPath);

    saveSearchCache(configPath, {
      fingerprint,
      // ferrosearch has no toJSON, so JSON.stringify(index) would not work;
      // toJsonString writes the MiniSearch version-2 format in one native pass.
      index: index.toJsonString(),
      docs: docs.map(({ content: _, ...rest }) => rest),
      backlinkCounts: Object.fromEntries(backlinkCounts),
    });
  }

  const maxMtime = Math.max(...docs.map((d) => d.mtime));
  const minMtime = Math.min(...docs.map((d) => d.mtime));
  const mtimeRange = maxMtime - minMtime || 1;

  return {
    rank(query: string): RankedHit[] {
      const results = index.search(query) as IndexHit[];
      const scored = results.map((r) => {
        const doc = docs[r.id];
        const links = backlinkCounts.get(doc.file) || 0;
        const recency = (doc.mtime - minMtime) / mtimeRange;
        // Backlinks are log-damped: hub notes in link-dense vaults collect
        // hundreds of inbound links, and a linear boost would swamp BM25
        // relevance for every query (734 links × 0.5 = +367 vs BM25's ~5–30).
        const composite = r.score + Math.log2(1 + links) + recency * 1.0;
        return {
          file: doc.file,
          score: Math.round(composite * 10) / 10,
          links,
          mtime: doc.mtime,
          content: doc.content,
        };
      });
      // Deterministic tie-break: rounded composites tie often, and the
      // native index's internal order differs across platforms — rankings
      // must not.
      scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
      return scored;
    },
  };
}

export function searchVault(
  contentPath: string,
  configPath: string,
  query: string,
  opts?: SearchOptions,
): SearchResult[] {
  const config = loadConfig(configPath);
  const corpus = loadSearchCorpus(contentPath, configPath, opts?.path);

  const contextLines = opts?.snippetLines ?? config.search.snippetLines;
  const limit = opts?.limit ?? config.search.limit;

  return corpus
    .rank(query)
    .slice(0, limit)
    .map((hit) => ({
      file: hit.file,
      score: hit.score,
      links: hit.links,
      modified: relativeTime(hit.mtime),
      snippets:
        opts?.snippets === false
          ? []
          : extractSnippets(hit.content, query, contextLines),
    }));
}
