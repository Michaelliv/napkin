import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getVaultMetadata } from "../core/vault.js";
import { DEFAULT_CONFIG, saveConfig } from "./config.js";
import { listFiles, listFolders } from "./files.js";
import { saveOverviewCache } from "./overview-cache.js";
import { saveSearchCache } from "./search-cache.js";
import { createTempVault } from "./test-helpers.js";
import { INTERNAL_FILES, SKIP_DIRS } from "./vault-internals.js";

/**
 * Ownership pin for the vault-internals taxonomy.
 *
 * SKIP_DIRS and INTERNAL_FILES are the single source of truth for what is
 * napkin/tooling rather than vault content. These tests iterate the owned
 * sets and exercise the real writers, so they fail when:
 *  - a walker (listFiles, listFolders, vault size) stops deriving from the
 *    owner and a member of the set leaks into its output, or
 *  - an internal-file writer starts producing a file that is not registered
 *    in INTERNAL_FILES.
 */

describe("vault-internals ownership", () => {
  test("every SKIP_DIRS member is invisible to every walker", () => {
    const files: Record<string, string> = { "real/note.md": "# Real note" };
    const vault = createTempVault(files);
    try {
      for (const dir of SKIP_DIRS) {
        fs.mkdirSync(path.join(vault.contentPath, dir), { recursive: true });
        fs.writeFileSync(
          path.join(vault.contentPath, dir, "junk.md"),
          "# Hidden",
        );
      }

      expect(listFiles(vault.contentPath, { ext: "md" })).toEqual([
        "real/note.md",
      ]);
      expect(listFolders(vault.contentPath)).toEqual(["real"]);

      const meta = getVaultMetadata({
        name: "t",
        contentPath: vault.contentPath,
        configPath: vault.contentPath,
        obsidianPath: path.join(vault.contentPath, ".obsidian"),
      });
      expect(meta.files).toBe(1);
      expect(meta.size).toBe(
        fs.statSync(path.join(vault.contentPath, "real/note.md")).size,
      );
    } finally {
      vault.cleanup();
    }
  });

  test("every file the internal writers create is registered and hidden", () => {
    const vault = createTempVault({ "note.md": "# Note" });
    try {
      // Exercise the real writers against a config dir that shares the
      // content root — the layout where INTERNAL_FILES matters.
      saveConfig(vault.contentPath, DEFAULT_CONFIG);
      saveSearchCache(vault.contentPath, {
        fingerprint: "f",
        index: "{}",
        docs: [],
        backlinkCounts: {},
      });
      saveOverviewCache(vault.contentPath, {
        fingerprint: "f",
        optionsKey: "k",
        result: {},
      });

      const rootEntries = fs
        .readdirSync(vault.contentPath, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => name !== "note.md");

      // Writer adds a new internal file without registering it → fails here.
      for (const name of rootEntries) {
        expect(INTERNAL_FILES.has(name)).toBe(true);
      }

      // Registered internal files never leak into content listings.
      expect(listFiles(vault.contentPath)).toEqual(["note.md"]);
    } finally {
      vault.cleanup();
    }
  });
});
