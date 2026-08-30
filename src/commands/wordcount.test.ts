import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { wordcount } from "./wordcount.js";

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
    "note.md":
      "---\ntitle: Test\n---\nHello world this is four words plus three.",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("wordcount", () => {
  test("counts words and characters", async () => {
    const data = await captureJson(() =>
      wordcount({ json: true, vault: v.projectPath, file: "note" }),
    );
    expect(data.words).toBe(8);
    expect(data.characters as number).toBeGreaterThan(0);
  });

  test("returns words only", async () => {
    const data = await captureJson(() =>
      wordcount({
        json: true,
        vault: v.projectPath,
        file: "note",
        words: true,
      }),
    );
    expect(data.words).toBe(8);
    expect(data.characters).toBeUndefined();
  });

  test("returns characters only", async () => {
    const data = await captureJson(() =>
      wordcount({
        json: true,
        vault: v.projectPath,
        file: "note",
        characters: true,
      }),
    );
    expect(data.characters).toBeGreaterThan(0);
    expect(data.words).toBeUndefined();
  });
});
