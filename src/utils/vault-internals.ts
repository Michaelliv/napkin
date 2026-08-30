/**
 * The closed set of napkin/tooling artifacts that are never vault content.
 * Every walker (file listing, folder listing, vault sizing, graph building)
 * and every internal-file writer (config, caches) derives from this module —
 * a new cache file or skip directory is registered here, nowhere else.
 */

/** Unified config, written by utils/config.ts. */
export const CONFIG_FILE = "config.json";
/** Search index cache, written by utils/search-cache.ts. */
export const SEARCH_CACHE_FILE = "search-cache.json";
/** Overview result cache, written by utils/overview-cache.ts. */
export const OVERVIEW_CACHE_FILE = "overview-cache.json";

/**
 * Internal files hidden from vault content listings when the config
 * directory shares the content root (embedded layout, tests).
 */
export const INTERNAL_FILES: ReadonlySet<string> = new Set([
  CONFIG_FILE,
  SEARCH_CACHE_FILE,
  OVERVIEW_CACHE_FILE,
]);

/** Directories no vault walker ever descends into. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".obsidian",
  ".git",
  ".trash",
  ".nanny",
  ".napkin",
  "node_modules",
]);
