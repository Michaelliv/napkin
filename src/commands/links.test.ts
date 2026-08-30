import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import {
  backlinks,
  deadends,
  links,
  orphans,
  unresolvedLinks,
} from "./links.js";

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
  v = createTempVault({
    "index.md": "# Index\nSee [[Alpha]] and [[Beta]]",
    "Alpha.md": "# Alpha\nLinks to [[Beta]] and [[Missing]]",
    "Beta.md": "# Beta\nLinks to [[Alpha]]",
    "orphan.md": "# Orphan\nNo one links here",
    "deadend.md": "# Dead End\nNo outgoing links at all.",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("backlinks", () => {
  test("finds backlinks to a file", async () => {
    const data = await captureJson(() =>
      backlinks({ json: true, vault: v.projectPath, file: "Alpha" }),
    );
    const bl = data.backlinks as string[];
    expect(bl).toContain("index.md");
    expect(bl).toContain("Beta.md");
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      backlinks({
        json: true,
        vault: v.projectPath,
        file: "Alpha",
        total: true,
      }),
    );
    expect(data.total).toBe(2);
  });
});

describe("links", () => {
  test("lists outgoing links", async () => {
    const data = await captureJson(() =>
      links({ json: true, vault: v.projectPath, file: "index" }),
    );
    const l = data.links as string[];
    expect(l).toContain("Alpha");
    expect(l).toContain("Beta");
  });
});

describe("unresolvedLinks", () => {
  test("finds unresolved links", async () => {
    const data = await captureJson(() =>
      unresolvedLinks({ json: true, vault: v.projectPath }),
    );
    const u = data.unresolved as string[];
    expect(u).toContain("Missing");
  });
});

describe("orphans", () => {
  test("finds files with no incoming links", async () => {
    const data = await captureJson(() =>
      orphans({ json: true, vault: v.projectPath }),
    );
    const o = data.orphans as string[];
    expect(o).toContain("orphan.md");
    expect(o).toContain("index.md"); // no one links to index
    expect(o).toContain("deadend.md"); // no one links to deadend
  });
});

describe("deadends", () => {
  test("finds files with no outgoing links", async () => {
    const data = await captureJson(() =>
      deadends({ json: true, vault: v.projectPath }),
    );
    const d = data.deadends as string[];
    expect(d).toContain("orphan.md");
    expect(d).toContain("deadend.md");
  });
});
