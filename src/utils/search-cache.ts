import * as fs from "node:fs";
import * as path from "node:path";
import { SEARCH_CACHE_FILE } from "./vault-internals.js";

export interface CachedDoc {
  id: number;
  file: string;
  basename: string;
  mtime: number;
}

export interface SearchCacheData {
  fingerprint: string;
  /** JSON-serialized MiniSearch index */
  index: string;
  /** Doc metadata (without content — content is re-read for snippets) */
  docs: CachedDoc[];
  /** file -> inbound link count */
  backlinkCounts: Record<string, number>;
}

/**
 * Load cached search index if the fingerprint matches.
 * Returns null if no cache, fingerprint mismatch, or corrupted data.
 */
export function loadSearchCache(
  configPath: string,
  currentFingerprint: string,
): SearchCacheData | null {
  const cachePath = path.join(configPath, SEARCH_CACHE_FILE);
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const data: SearchCacheData = JSON.parse(raw);
    if (data.fingerprint !== currentFingerprint) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save search index cache to disk.
 */
export function saveSearchCache(
  configPath: string,
  data: SearchCacheData,
): void {
  fs.writeFileSync(
    path.join(configPath, SEARCH_CACHE_FILE),
    JSON.stringify(data),
  );
}
