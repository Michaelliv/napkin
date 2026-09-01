import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getOverview } from "../core/overview.js";
import { createTempVault } from "./test-helpers.js";
import { OVERVIEW_CACHE_FILE } from "./vault-internals.js";

/**
 * The overview cache stores the final VaultOverview keyed by a whole-vault
 * mtime fingerprint plus the resolved options. These tests observe caching
 * strictly through getOverview behavior:
 *  - a frozen-mtime content rewrite must be INVISIBLE (cache hit, no re-read)
 *  - any mtime bump, file add, or file remove must be VISIBLE (recompute)
 *  - changed options must never be served another variant's cached result
 */

const NOTE_A = "# Alpha\nkubernetes ingress routing policies cluster";
const NOTE_A2 = "# Alpha\nsourdough fermentation hydration schedules levain";
const NOTE_B = "# Beta\npayroll withholding contractors ledger invoices";

const FIXED_TIME = new Date("2024-06-01T12:00:00Z");

function freezeMtime(p: string): void {
  fs.utimesSync(p, FIXED_TIME, FIXED_TIME);
}

describe("overview cache", () => {
  test("writes a cache file on first run", () => {
    const vault = createTempVault({ "notes/a.md": NOTE_A });
    try {
      getOverview(vault.vault);
      expect(
        fs.existsSync(path.join(vault.contentPath, OVERVIEW_CACHE_FILE)),
      ).toBe(true);
    } finally {
      vault.cleanup();
    }
  });

  test("cache hit: frozen-mtime rewrite is invisible", () => {
    const vault = createTempVault({ "notes/a.md": NOTE_A });
    const notePath = path.join(vault.contentPath, "notes/a.md");
    try {
      freezeMtime(notePath);
      const first = getOverview(vault.vault);
      expect(first.overview[0].keywords).toContain("kubernetes");

      // rewrite content but keep the identical mtime → fingerprint unchanged
      fs.writeFileSync(notePath, NOTE_A2);
      freezeMtime(notePath);

      const second = getOverview(vault.vault);
      expect(second).toEqual(first); // served from cache, file not re-read
    } finally {
      vault.cleanup();
    }
  });

  test("mtime bump invalidates", () => {
    const vault = createTempVault({ "notes/a.md": NOTE_A });
    const notePath = path.join(vault.contentPath, "notes/a.md");
    try {
      freezeMtime(notePath);
      const first = getOverview(vault.vault);
      expect(first.overview[0].keywords).toContain("kubernetes");

      fs.writeFileSync(notePath, NOTE_A2);
      const later = new Date(FIXED_TIME.getTime() + 5000);
      fs.utimesSync(notePath, later, later);

      const second = getOverview(vault.vault);
      expect(second.overview[0].keywords).toContain("sourdough");
      expect(second.overview[0].keywords).not.toContain("kubernetes");
    } finally {
      vault.cleanup();
    }
  });

  test("added and removed files invalidate", () => {
    const vault = createTempVault({ "notes/a.md": NOTE_A });
    const bPath = path.join(vault.contentPath, "notes/b.md");
    try {
      const first = getOverview(vault.vault);
      expect(first.overview[0].notes).toBe(1);

      fs.writeFileSync(bPath, NOTE_B);
      const second = getOverview(vault.vault);
      expect(second.overview[0].notes).toBe(2);

      fs.rmSync(bPath);
      const third = getOverview(vault.vault);
      expect(third.overview[0].notes).toBe(1);
    } finally {
      vault.cleanup();
    }
  });

  test("different options are never served another variant's cache", () => {
    // Seven distinct notes so the keywords cap bites at both 5 and 3.
    const names = [
      "kubernetes",
      "sourdough",
      "payroll",
      "telescope",
      "beehive",
      "marathon",
      "espresso",
    ];
    const files: Record<string, string> = {};
    for (const name of names) {
      files[`notes/${name}.md`] = `# ${name}\n${name} deep dive notes`;
    }
    const vault = createTempVault(files);
    try {
      const five = getOverview(vault.vault, {
        keywords: 5,
      });
      expect(five.overview[0].keywords.length).toBe(5);

      const three = getOverview(vault.vault, {
        keywords: 3,
      });
      expect(three.overview[0].keywords.length).toBe(3);

      // and back: no stale first variant either
      const fiveAgain = getOverview(vault.vault, {
        keywords: 5,
      });
      expect(fiveAgain.overview[0].keywords.length).toBe(5);
    } finally {
      vault.cleanup();
    }
  });

  test("corrupted cache file is ignored and rebuilt", () => {
    const vault = createTempVault({ "notes/a.md": NOTE_A });
    const cachePath = path.join(vault.contentPath, OVERVIEW_CACHE_FILE);
    try {
      getOverview(vault.vault);
      fs.writeFileSync(cachePath, "{not json!!");

      const result = getOverview(vault.vault);
      expect(result.overview[0].keywords).toContain("kubernetes");
      // cache restored to a valid state
      const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(typeof raw.fingerprint).toBe("string");
    } finally {
      vault.cleanup();
    }
  });

  test("cached result includes context and warnings", () => {
    const vault = createTempVault({
      "NAPKIN.md": "# Context note",
      "notes/a.md": NOTE_A,
      "notes/bad.md": "---\ntags: [#broken, #cache-test]\n---\n# Bad",
    });
    try {
      const first = getOverview(vault.vault);
      const second = getOverview(vault.vault);
      expect(second.context).toBe("# Context note");
      expect(second.warnings).toEqual([
        "Skipping notes/bad.md (malformed YAML frontmatter)",
      ]);
      expect(second).toEqual(first);
    } finally {
      vault.cleanup();
    }
  });
});
