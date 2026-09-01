import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_CONFIG,
  Napkin,
  type NapkinConfig,
  type NapkinOptions,
  SIBLING_VAULT_LAYOUT,
} from "./index.js";
import { createTempVault } from "./utils/test-helpers.js";
import { CONFIG_FILE } from "./utils/vault-internals.js";

/**
 * Config injection: an instance built with a config in code takes every
 * setting from it and never reads .napkin/config.json.
 *
 * Each vault here is poisoned — its config.json says something the injected
 * config contradicts, and both differ from DEFAULT_CONFIG. So a value that
 * shows up in behavior identifies where it came from: the file, the code, or
 * a silent fallback to defaults.
 */

const POISON: NapkinConfig = {
  overview: { depth: 1, keywords: 2, collapse: true },
  search: { limit: 1, snippetLines: 0 },
  daily: { folder: "PoisonDaily", format: "YYYY-MM-DD" },
  templates: { folder: "PoisonTemplates" },
  graph: { renderer: "auto" },
};

const INJECTED: NapkinConfig = {
  overview: { depth: 2, keywords: 5, collapse: true },
  search: { limit: 7, snippetLines: 0 },
  daily: { folder: "Journal", format: "YYYY-MM-DD" },
  templates: { folder: "Blueprints" },
  graph: { renderer: "auto" },
};

const FILES: Record<string, string> = {
  "notes/alpha.md": "# Alpha\nalpha kubernetes ingress routing",
  "notes/beta.md": "# Beta\nalpha payroll withholding ledger",
  "notes/deep/gamma.md": "# Gamma\nalpha telescope aperture mounts",
  "notes/deep/deeper/delta.md": "# Delta\nalpha sourdough levain hydration",
  "Blueprints/Code.md": "# {{title}}\ncode template",
  "PoisonTemplates/Poison.md": "# {{title}}\npoison template",
};

let v: ReturnType<typeof createTempVault>;
let injected: Napkin;
let bare: Napkin;

beforeEach(() => {
  v = createTempVault(FILES, POISON);
  injected = new Napkin(v.projectPath, { config: INJECTED });
  bare = new Napkin(v.projectPath);
});

afterEach(() => {
  v.cleanup();
});

describe("injected config beats the vault file", () => {
  test("search.limit", () => {
    expect(injected.search("alpha").length).toBe(4);
    expect(bare.search("alpha").length).toBe(1);
  });

  test("templates.folder", () => {
    expect(injected.templates()).toEqual(["Code"]);
    expect(bare.templates()).toEqual(["Poison"]);
  });

  test("daily.folder", () => {
    expect(injected.dailyPath()).toStartWith("Journal/");
    expect(bare.dailyPath()).toStartWith("PoisonDaily/");
  });

  test("overview.depth", () => {
    const rows = (n: Napkin) => n.overview().overview.map((f) => f.path);
    expect(rows(injected)).toContain("notes/deep");
    expect(rows(bare)).not.toContain("notes/deep");
  });

  test("overview excludes its own templates folder, not the file's", () => {
    const rows = (n: Napkin) => n.overview().overview.map((f) => f.path);
    expect(rows(injected)).toContain("PoisonTemplates");
    expect(rows(injected)).not.toContain("Blueprints");
    expect(rows(bare)).toContain("Blueprints");
    expect(rows(bare)).not.toContain("PoisonTemplates");
  });

  test("per-call options still win, falling back to the injected config", () => {
    expect(injected.search("alpha", { limit: 2 }).length).toBe(2);
    expect(
      injected.overview({ depth: 1 }).overview.map((f) => f.path),
    ).not.toContain("notes/deep");
  });

  test("configGet reads the injected config", () => {
    expect(injected.configGet("search.limit")).toBe(7);
    expect(bare.configGet("search.limit")).toBe(1);
  });

  test("instances with different configs never share a cached overview", () => {
    // One vault, one overview-cache file, three configurations: the cache
    // key carries the resolved options, so each gets its own entry.
    const shallow = new Napkin(v.projectPath, {
      config: { ...INJECTED, overview: { ...INJECTED.overview, depth: 1 } },
    });
    const deep = new Napkin(v.projectPath, {
      config: { ...INJECTED, overview: { ...INJECTED.overview, depth: 3 } },
    });

    const paths = (n: Napkin) => n.overview().overview.map((f) => f.path);
    const shallowRows = paths(shallow);
    const deepRows = paths(deep);

    expect(shallowRows).not.toContain("notes/deep");
    expect(deepRows).toContain("notes/deep/deeper");
    expect(paths(injected)).toContain("notes/deep");
    expect(paths(injected)).not.toContain("notes/deep/deeper");

    // second pass, now that every variant is cached
    expect(paths(shallow)).toEqual(shallowRows);
    expect(paths(deep)).toEqual(deepRows);
  });
});

describe("the vault layout comes from the injected config", () => {
  test("injected layout overrides the file's", () => {
    // The file says embedded (no vault key) — .napkin/ is the content root.
    const sibling = new Napkin(v.projectPath, {
      config: { ...INJECTED, vault: SIBLING_VAULT_LAYOUT },
    });
    expect(sibling.vault.contentPath).toBe(v.projectPath);
    expect(bare.vault.contentPath).toBe(v.contentPath);
  });

  test("a file layout does not leak into an injected instance", () => {
    const siblingVault = createTempVault(FILES, {
      ...POISON,
      vault: SIBLING_VAULT_LAYOUT,
    });
    try {
      const embedded = new Napkin(siblingVault.projectPath, {
        config: INJECTED,
      });
      expect(embedded.vault.contentPath).toBe(siblingVault.contentPath);
      expect(embedded.fileList()).toContain("notes/alpha.md");

      const followsFile = new Napkin(siblingVault.projectPath);
      expect(followsFile.vault.contentPath).toBe(siblingVault.projectPath);
      expect(followsFile.fileList()).not.toContain("notes/alpha.md");
    } finally {
      siblingVault.cleanup();
    }
  });
});

describe("config.json is never read", () => {
  test("deleting it changes nothing an injected instance does", () => {
    const before = {
      search: injected.search("alpha").length,
      templates: injected.templates(),
      daily: injected.dailyPath(),
      overview: injected.overview().overview.map((f) => f.path),
      config: injected.config(),
    };

    // Any surviving read would now either throw or fall back to
    // DEFAULT_CONFIG, whose values differ from every field above.
    fs.rmSync(path.join(v.contentPath, CONFIG_FILE));

    expect(injected.search("alpha").length).toBe(before.search);
    expect(injected.templates()).toEqual(before.templates);
    expect(injected.dailyPath()).toEqual(before.daily);
    expect(injected.overview().overview.map((f) => f.path)).toEqual(
      before.overview,
    );
    expect(injected.config()).toEqual(before.config);
    expect(before.config.search.limit).not.toBe(DEFAULT_CONFIG.search.limit);
  });

  test("a bare instance on the same vault does read it", () => {
    expect(bare.configGet("templates.folder")).toBe("PoisonTemplates");
    fs.writeFileSync(
      path.join(v.contentPath, CONFIG_FILE),
      JSON.stringify({ ...POISON, templates: { folder: "Rewritten" } }),
    );
    expect(bare.configGet("templates.folder")).toBe("Rewritten");
    expect(injected.configGet("templates.folder")).toBe("Blueprints");
  });
});

describe("the injected config is the instance's own", () => {
  test("config() returns the injected values, frozen", () => {
    const cfg = injected.config();
    expect(cfg).toEqual(INJECTED);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.overview)).toBe(true);
    expect(() => {
      (cfg as NapkinConfig).search.limit = 99;
    }).toThrow();
  });

  test("the caller's object is copied, not captured", () => {
    const mutable: NapkinConfig = structuredClone(INJECTED);
    const n = new Napkin(v.projectPath, { config: mutable });
    mutable.search.limit = 99;
    expect(n.config().search.limit).toBe(7);
    expect(Object.isFrozen(mutable)).toBe(false);
  });

  test("configSet refuses, and leaves the file untouched", () => {
    const configFile = path.join(v.contentPath, CONFIG_FILE);
    const before = fs.readFileSync(configFile, "utf-8");

    expect(() => injected.configSet("search.limit", "50")).toThrow(
      "config is injected in code; edit the source, not the vault",
    );
    expect(fs.readFileSync(configFile, "utf-8")).toBe(before);

    // A vault that owns its config still writes.
    bare.configSet("search.limit", "50");
    expect(bare.configGet("search.limit")).toBe(50);
  });

  test("the options parameter is typed by the exported NapkinConfig", () => {
    const options: NapkinOptions = { config: DEFAULT_CONFIG };
    const n = new Napkin(v.projectPath, options);
    expect(n.config()).toEqual(DEFAULT_CONFIG);
  });
});
