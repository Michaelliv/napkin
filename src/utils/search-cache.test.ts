import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import MiniSearch from "minisearch";
import { searchVault } from "../core/search.js";
import { computeFingerprint } from "./fingerprint.js";
import { loadSearchCache, saveSearchCache } from "./search-cache.js";
import { createTempVault } from "./test-helpers.js";
import { SEARCH_CACHE_FILE } from "./vault-internals.js";

let vault: { projectPath: string; contentPath: string; cleanup: () => void };

beforeEach(() => {
  vault = createTempVault({
    "README.md": "# Vault\nWelcome",
    "Projects/alpha.md": "# Alpha\nThe alpha project",
    "Projects/beta.md": "# Beta\nBeta project",
  });
});

afterEach(() => {
  vault.cleanup();
});

describe("saveSearchCache / loadSearchCache", () => {
  test("round-trips cache data", () => {
    const fingerprint = computeFingerprint(vault.contentPath);
    const data = {
      fingerprint,
      index: '{"serialized":"index"}',
      docs: [{ id: 0, file: "README.md", basename: "README", mtime: 1000 }],
      backlinkCounts: { "README.md": 2 },
    };

    saveSearchCache(vault.contentPath, data);
    const loaded = loadSearchCache(vault.contentPath, fingerprint);

    expect(loaded).not.toBeNull();
    expect(loaded?.index).toBe(data.index);
    expect(loaded?.docs).toEqual(data.docs);
    expect(loaded?.backlinkCounts).toEqual(data.backlinkCounts);
  });

  test("returns null when no cache exists", () => {
    const loaded = loadSearchCache(vault.contentPath, "any-fingerprint");
    expect(loaded).toBeNull();
  });

  test("returns null when fingerprint doesn't match", () => {
    const data = {
      fingerprint: "old-fingerprint",
      index: "{}",
      docs: [],
      backlinkCounts: {},
    };
    saveSearchCache(vault.contentPath, data);

    const loaded = loadSearchCache(vault.contentPath, "new-fingerprint");
    expect(loaded).toBeNull();
  });

  test("cache file lives in config dir", () => {
    const data = {
      fingerprint: "test",
      index: "{}",
      docs: [],
      backlinkCounts: {},
    };
    saveSearchCache(vault.contentPath, data);

    expect(fs.existsSync(path.join(vault.contentPath, SEARCH_CACHE_FILE))).toBe(
      true,
    );
  });

  test("returns null on corrupted cache file", () => {
    fs.writeFileSync(
      path.join(vault.contentPath, SEARCH_CACHE_FILE),
      "not valid json{{{",
    );

    const loaded = loadSearchCache(vault.contentPath, "any");
    expect(loaded).toBeNull();
  });
});

describe("minisearch cache migration", () => {
  test("a cache blob written by minisearch loads and searches identically", () => {
    // Vaults in the wild have search-cache.json blobs serialized by
    // minisearch (napkin < ferrosearch swap). ferrosearch reads the same
    // version-2 format, so old caches must keep working without a rebuild.
    const fresh = searchVault(vault.contentPath, vault.contentPath, "alpha");
    expect(fresh.length).toBeGreaterThan(0);

    const files = ["README.md", "Projects/alpha.md", "Projects/beta.md"];
    const legacy = new MiniSearch({
      fields: ["basename", "content"],
      storeFields: ["file"],
      searchOptions: { boost: { basename: 2 }, fuzzy: 0.2, prefix: true },
    });
    legacy.addAll(
      files.map((file, id) => ({
        id,
        file,
        basename: path.basename(file, ".md"),
        content: fs.readFileSync(path.join(vault.contentPath, file), "utf-8"),
      })),
    );

    saveSearchCache(vault.contentPath, {
      fingerprint: computeFingerprint(vault.contentPath),
      index: JSON.stringify(legacy), // the old serialization call
      docs: files.map((file, id) => ({
        id,
        file,
        basename: path.basename(file, ".md"),
        mtime: fs.statSync(path.join(vault.contentPath, file)).mtimeMs,
      })),
      backlinkCounts: {},
    });

    const fromLegacyCache = searchVault(
      vault.contentPath,
      vault.contentPath,
      "alpha",
    );
    expect(fromLegacyCache.map((r) => [r.file, r.score])).toEqual(
      fresh.map((r) => [r.file, r.score]),
    );
  });
});
