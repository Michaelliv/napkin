import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import MiniSearch from "minisearch";
import { searchVault } from "../core/search.js";
import {
  computeFingerprint,
  loadSearchCache,
  saveSearchCache,
} from "./search-cache.js";
import { createTempVault } from "./test-helpers.js";

let vault: { path: string; vaultPath: string; cleanup: () => void };

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

describe("computeFingerprint", () => {
  test("returns consistent fingerprint for same files", () => {
    const fp1 = computeFingerprint(vault.vaultPath);
    const fp2 = computeFingerprint(vault.vaultPath);
    expect(fp1).toBe(fp2);
  });

  test("changes when a file is added", () => {
    const fp1 = computeFingerprint(vault.vaultPath);
    fs.writeFileSync(path.join(vault.vaultPath, "new.md"), "# New");
    const fp2 = computeFingerprint(vault.vaultPath);
    expect(fp1).not.toBe(fp2);
  });

  test("changes when a file is modified", () => {
    const fp1 = computeFingerprint(vault.vaultPath);
    // Ensure mtime changes (some filesystems have 1s resolution)
    const filePath = path.join(vault.vaultPath, "README.md");
    const futureTime = Date.now() + 2000;
    fs.utimesSync(filePath, futureTime / 1000, futureTime / 1000);
    const fp2 = computeFingerprint(vault.vaultPath);
    expect(fp1).not.toBe(fp2);
  });

  test("changes when a file is deleted", () => {
    const fp1 = computeFingerprint(vault.vaultPath);
    fs.unlinkSync(path.join(vault.vaultPath, "README.md"));
    const fp2 = computeFingerprint(vault.vaultPath);
    expect(fp1).not.toBe(fp2);
  });
});

describe("saveSearchCache / loadSearchCache", () => {
  test("round-trips cache data", () => {
    const fingerprint = computeFingerprint(vault.vaultPath);
    const data = {
      fingerprint,
      index: '{"serialized":"index"}',
      docs: [{ id: 0, file: "README.md", basename: "README", mtime: 1000 }],
      backlinkCounts: { "README.md": 2 },
    };

    saveSearchCache(vault.vaultPath, data);
    const loaded = loadSearchCache(vault.vaultPath, fingerprint);

    expect(loaded).not.toBeNull();
    expect(loaded?.index).toBe(data.index);
    expect(loaded?.docs).toEqual(data.docs);
    expect(loaded?.backlinkCounts).toEqual(data.backlinkCounts);
  });

  test("returns null when no cache exists", () => {
    const loaded = loadSearchCache(vault.vaultPath, "any-fingerprint");
    expect(loaded).toBeNull();
  });

  test("returns null when fingerprint doesn't match", () => {
    const data = {
      fingerprint: "old-fingerprint",
      index: "{}",
      docs: [],
      backlinkCounts: {},
    };
    saveSearchCache(vault.vaultPath, data);

    const loaded = loadSearchCache(vault.vaultPath, "new-fingerprint");
    expect(loaded).toBeNull();
  });

  test("cache file lives in config dir", () => {
    const data = {
      fingerprint: "test",
      index: "{}",
      docs: [],
      backlinkCounts: {},
    };
    saveSearchCache(vault.vaultPath, data);

    expect(fs.existsSync(path.join(vault.vaultPath, "search-cache.json"))).toBe(
      true,
    );
  });

  test("returns null on corrupted cache file", () => {
    fs.writeFileSync(
      path.join(vault.vaultPath, "search-cache.json"),
      "not valid json{{{",
    );

    const loaded = loadSearchCache(vault.vaultPath, "any");
    expect(loaded).toBeNull();
  });
});

describe("minisearch cache migration", () => {
  test("a cache blob written by minisearch loads and searches identically", () => {
    // Vaults in the wild have search-cache.json blobs serialized by
    // minisearch (napkin < ferrosearch swap). ferrosearch reads the same
    // version-2 format, so old caches must keep working without a rebuild.
    const fresh = searchVault(vault.vaultPath, vault.vaultPath, "alpha");
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
        content: fs.readFileSync(path.join(vault.vaultPath, file), "utf-8"),
      })),
    );

    saveSearchCache(vault.vaultPath, {
      fingerprint: computeFingerprint(vault.vaultPath),
      index: JSON.stringify(legacy), // the old serialization call
      docs: files.map((file, id) => ({
        id,
        file,
        basename: path.basename(file, ".md"),
        mtime: fs.statSync(path.join(vault.vaultPath, file)).mtimeMs,
      })),
      backlinkCounts: {},
    });

    const fromLegacyCache = searchVault(
      vault.vaultPath,
      vault.vaultPath,
      "alpha",
    );
    expect(fromLegacyCache.map((r) => [r.file, r.score])).toEqual(
      fresh.map((r) => [r.file, r.score]),
    );
  });
});
