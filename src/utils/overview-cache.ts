import * as fs from "node:fs";
import * as path from "node:path";

const CACHE_FILE = "overview-cache.json";

export interface OverviewCacheData<T> {
  /** Whole-vault fingerprint (file paths + mtimes), see computeFingerprint. */
  fingerprint: string;
  /** Resolved options the result was computed with (depth, keywords, ...). */
  optionsKey: string;
  result: T;
}

/**
 * Load the cached overview result if both the vault fingerprint and the
 * resolved options match. Returns null on miss, mismatch, or corruption.
 *
 * Single-entry cache, same trade-off as the search cache: the stored result
 * is a few KB, and the dominant call pattern (agents re-running `napkin
 * overview` with default options between reads) hits one variant.
 */
export function loadOverviewCache<T>(
  configPath: string,
  fingerprint: string,
  optionsKey: string,
): T | null {
  try {
    const raw = fs.readFileSync(path.join(configPath, CACHE_FILE), "utf-8");
    const data: OverviewCacheData<T> = JSON.parse(raw);
    if (data.fingerprint !== fingerprint) return null;
    if (data.optionsKey !== optionsKey) return null;
    return data.result;
  } catch {
    return null;
  }
}

export function saveOverviewCache<T>(
  configPath: string,
  data: OverviewCacheData<T>,
): void {
  fs.writeFileSync(path.join(configPath, CACHE_FILE), JSON.stringify(data));
}
