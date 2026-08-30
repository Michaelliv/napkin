import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";
import { bookmark, bookmarks } from "./bookmarks.js";

let v: ReturnType<typeof createTempVault>;

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
  v = createTempVault({});
  // Write initial bookmarks
  fs.writeFileSync(
    path.join(v.contentPath, ".obsidian", "bookmarks.json"),
    JSON.stringify([
      { type: "file", path: "note.md", title: "My Note" },
      { type: "search", query: "TODO" },
    ]),
  );
});

afterEach(() => {
  v.cleanup();
});

describe("bookmarks", () => {
  test("lists bookmarks", async () => {
    const data = await captureJson(() =>
      bookmarks({ json: true, vault: v.projectPath }),
    );
    const b = data.bookmarks as { type: string }[];
    expect(b.length).toBe(2);
    expect(b[0].type).toBe("file");
    expect(b[1].type).toBe("search");
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      bookmarks({ json: true, vault: v.projectPath, total: true }),
    );
    expect(data.total).toBe(2);
  });

  test("returns empty when no bookmarks file", async () => {
    fs.unlinkSync(path.join(v.contentPath, ".obsidian", "bookmarks.json"));
    const data = await captureJson(() =>
      bookmarks({ json: true, vault: v.projectPath }),
    );
    expect((data.bookmarks as unknown[]).length).toBe(0);
  });
});

describe("bookmark", () => {
  test("adds a file bookmark", async () => {
    await captureJson(() =>
      bookmark({
        json: true,
        vault: v.projectPath,
        file: "new.md",
        title: "New",
      }),
    );
    const raw = fs.readFileSync(
      path.join(v.contentPath, ".obsidian", "bookmarks.json"),
      "utf-8",
    );
    const items = JSON.parse(raw);
    expect(items.length).toBe(3);
    expect(items[2].type).toBe("file");
    expect(items[2].path).toBe("new.md");
  });

  test("adds a search bookmark", async () => {
    await captureJson(() =>
      bookmark({ json: true, vault: v.projectPath, search: "FIXME" }),
    );
    const raw = fs.readFileSync(
      path.join(v.contentPath, ".obsidian", "bookmarks.json"),
      "utf-8",
    );
    const items = JSON.parse(raw);
    expect(items[2].type).toBe("search");
    expect(items[2].query).toBe("FIXME");
  });

  test("adds a URL bookmark", async () => {
    await captureJson(() =>
      bookmark({
        json: true,
        vault: v.projectPath,
        url: "https://example.com",
      }),
    );
    const raw = fs.readFileSync(
      path.join(v.contentPath, ".obsidian", "bookmarks.json"),
      "utf-8",
    );
    const items = JSON.parse(raw);
    expect(items[2].type).toBe("url");
    expect(items[2].url).toBe("https://example.com");
  });
});
