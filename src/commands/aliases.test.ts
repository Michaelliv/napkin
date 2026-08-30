import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { aliases } from "./aliases.js";

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
    "note1.md": "---\naliases:\n  - Alpha\n  - A1\n---\nBody",
    "note2.md": "---\naliases: Beta\n---\nBody",
    "note3.md": "No aliases here",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("aliases", () => {
  test("lists all aliases", async () => {
    const data = await captureJson(() =>
      aliases({ json: true, vault: v.projectPath }),
    );
    const a = data.aliases as string[];
    expect(a).toContain("Alpha");
    expect(a).toContain("A1");
    expect(a).toContain("Beta");
    expect(a.length).toBe(3);
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      aliases({ json: true, vault: v.projectPath, total: true }),
    );
    expect(data.total).toBe(3);
  });

  test("filters by file", async () => {
    const data = await captureJson(() =>
      aliases({ json: true, vault: v.projectPath, file: "note1" }),
    );
    const a = data.aliases as string[];
    expect(a).toEqual(["Alpha", "A1"]);
  });

  test("verbose includes file paths", async () => {
    const data = await captureJson(() =>
      aliases({ json: true, vault: v.projectPath, verbose: true }),
    );
    const a = data.aliases as { alias: string; file: string }[];
    expect(a[0].file).toBeTruthy();
  });
});
