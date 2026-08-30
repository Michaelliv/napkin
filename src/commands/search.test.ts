import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";
import { SEARCH_CACHE_FILE } from "../utils/vault-internals.js";
import { search } from "./search.js";

let v: { projectPath: string; contentPath: string; cleanup: () => void };

async function captureJson(
  fn: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const orig = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  await fn();
  console.log = orig;
  return JSON.parse(logs.join(""));
}

beforeEach(() => {
  v = createTempVault({
    "Projects/alpha.md": "# Alpha\nThis is the alpha project\nWith TODO items",
    "Projects/beta.md": "# Beta\nBeta has no tasks",
    "Resources/guide.md": "# Guide\nRefer to the [[alpha]] project here",
    "README.md": "# Vault\nWelcome to the vault",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("search", () => {
  test("finds files matching query with scores", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );
    const results = data.results as { file: string; score?: number }[];
    const files = results.map((r) => r.file);
    expect(files).toContain("Projects/alpha.md");
    expect(files).toContain("Resources/guide.md");
    // Score hidden by default
    expect(results[0].score).toBeUndefined();

    // Score shown with --score flag
    const withScore = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha", score: true }),
    );
    const scored = withScore.results as { score: number }[];
    expect(scored[0].score).toBeGreaterThan(0);
  });

  test("results include snippets by default", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "TODO" }),
    );
    const results = data.results as {
      file: string;
      snippets: { line: number; text: string }[];
    }[];
    expect(results.length).toBeGreaterThan(0);
    const alpha = results.find((r) => r.file === "Projects/alpha.md");
    expect(alpha).toBeDefined();
    expect(alpha?.snippets.length).toBeGreaterThan(0);
    expect(alpha?.snippets.some((s) => s.text.includes("TODO"))).toBeTrue();
  });

  test("no-snippets returns files only", async () => {
    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "alpha",
        snippets: false,
      }),
    );
    const results = data.results as { file: string; snippets?: unknown }[];
    expect(results[0].snippets).toBeUndefined();
  });

  test("filters by folder", async () => {
    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "alpha",
        path: "Projects",
      }),
    );
    const results = data.results as { file: string }[];
    expect(results.length).toBe(1);
    expect(results[0].file).toBe("Projects/alpha.md");
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha", total: true }),
    );
    expect(data.total).toBe(2);
  });

  test("limits results", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "the", limit: "1" }),
    );
    const results = data.results as { file: string }[];
    expect(results.length).toBe(1);
  });

  test("results include backlink count", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );
    const results = data.results as { file: string; links: number }[];
    const alpha = results.find((r) => r.file === "Projects/alpha.md");
    expect(alpha).toBeDefined();
    // guide.md links to [[alpha]], so alpha should have links >= 1
    expect(alpha?.links).toBeGreaterThanOrEqual(1);
  });

  test("results include modified time", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );
    const results = data.results as { file: string; modified: string }[];
    expect(results[0].modified).toMatch(/ago$/);
  });

  test("--snippet-lines adds context around matches", async () => {
    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "TODO",
        snippetLines: "1",
      }),
    );
    const results = data.results as {
      snippets: { line: number; text: string }[];
    }[];
    const alpha = results.find((r: any) => r.file === "Projects/alpha.md");
    expect(alpha).toBeDefined();
    // With context=1, should include lines around the match
    expect(alpha?.snippets.length).toBeGreaterThan(1);
  });

  test("does not index the .gitignore file itself", async () => {
    fs.writeFileSync(
      path.join(v.contentPath, ".gitignore"),
      "gitignore-only-marker\n",
    );

    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "gitignore-only-marker",
      }),
    );
    const results = data.results as { file: string }[];
    expect(results).toEqual([]);
  });

  test("currently indexes Markdown files matched by .gitignore", async () => {
    fs.writeFileSync(path.join(v.contentPath, ".gitignore"), "generated/\n");
    fs.mkdirSync(path.join(v.contentPath, "generated"), { recursive: true });
    fs.writeFileSync(
      path.join(v.contentPath, "generated", "ignored.md"),
      "# Generated\nignored-markdown-marker\n",
    );

    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "ignored-markdown-marker",
      }),
    );
    const results = data.results as { file: string }[];
    expect(results.map((result) => result.file)).toContain(
      "generated/ignored.md",
    );
  });

  test("empty query returns no results", async () => {
    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "xyznonexistent999",
      }),
    );
    const results = data.results as unknown[];
    expect(results.length).toBe(0);
  });

  test("--score includes score in json output", async () => {
    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "alpha",
        score: true,
      }),
    );
    const results = data.results as { score: number }[];
    expect(results[0].score).toBeNumber();
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("score hidden by default in json output", async () => {
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );
    const results = data.results as { score?: number }[];
    expect(results[0].score).toBeUndefined();
  });

  test("creates cache file after first search", async () => {
    const cachePath = path.join(v.contentPath, SEARCH_CACHE_FILE);
    expect(fs.existsSync(cachePath)).toBe(false);

    await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );

    expect(fs.existsSync(cachePath)).toBe(true);
  });

  test("second search uses cache and returns same results", async () => {
    // First search — builds and caches
    const data1 = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha", score: true }),
    );

    // Second search — should use cache
    const data2 = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha", score: true }),
    );

    const results1 = data1.results as { file: string; score: number }[];
    const results2 = data2.results as { file: string; score: number }[];
    expect(results1.map((r) => r.file)).toEqual(results2.map((r) => r.file));
    expect(results1.map((r) => r.score)).toEqual(results2.map((r) => r.score));
  });

  test("cache invalidated when file changes", async () => {
    // First search — builds cache
    await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );

    // Modify a file
    const filePath = path.join(v.contentPath, "Projects/alpha.md");
    const futureTime = Date.now() + 2000;
    fs.utimesSync(filePath, futureTime / 1000, futureTime / 1000);

    // Second search — cache should be invalidated, still returns results
    const data = await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );
    const results = data.results as { file: string }[];
    expect(results.map((r) => r.file)).toContain("Projects/alpha.md");
  });

  test("does not crash on ambiguous file references in backlinks", async () => {
    const vault = createTempVault({
      "NAPKIN.md": "# Vault context\nThis is the vault root context",
      "projects/napkin.md": "# Napkin project\nThe napkin tool itself",
      "notes/reference.md":
        "# Reference\nSee [[napkin]] for details on decisions",
    });

    const data = await captureJson(() =>
      search({ json: true, vault: vault.projectPath, query: "decisions" }),
    );
    const results = data.results as { file: string; links: number }[];
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.file)).toContain("notes/reference.md");

    // [[napkin]] resolves to shallowest path (NAPKIN.md), which gets the backlink
    const withLinks = await captureJson(() =>
      search({
        json: true,
        vault: vault.projectPath,
        query: "napkin",
        score: true,
      }),
    );
    const allResults = withLinks.results as { file: string; links: number }[];
    const napkinRoot = allResults.find((r) => r.file === "NAPKIN.md");
    expect(napkinRoot).toBeDefined();
    expect(napkinRoot?.links).toBeGreaterThanOrEqual(1);

    vault.cleanup();
  });

  test("backlink hubs do not outrank topical notes", async () => {
    // A hub note collecting many inbound links must not win every query:
    // the backlink boost is log-damped so BM25 relevance stays decisive.
    const files: Record<string, string> = {
      "people/Hub.md": "# Hub\nWell connected person. Mentions allergen once.",
      "entities/Allergen Matrix.md":
        "# Allergen Matrix\nallergen thresholds, allergen labeling, allergen matrix per product line",
    };
    for (let i = 0; i < 60; i++) {
      files[`notes/note-${i}.md`] = `# Note ${i}\nSee [[Hub]] for context.`;
    }
    const vault = createTempVault(files);

    const data = await captureJson(() =>
      search({ json: true, vault: vault.projectPath, query: "allergen" }),
    );
    const results = data.results as { file: string }[];
    expect(results[0].file).toBe("entities/Allergen Matrix.md");

    vault.cleanup();
  });

  test("cache not used when searching a subfolder", async () => {
    // Cache is folder-specific — searching with --path shouldn't use full-vault cache
    await captureJson(() =>
      search({ json: true, vault: v.projectPath, query: "alpha" }),
    );

    const data = await captureJson(() =>
      search({
        json: true,
        vault: v.projectPath,
        query: "alpha",
        path: "Projects",
      }),
    );
    const results = data.results as { file: string }[];
    expect(results.length).toBe(1);
    expect(results[0].file).toBe("Projects/alpha.md");
  });
});
