import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { outline } from "./outline.js";

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
    "doc.md":
      "# Title\n\nText\n\n## Section A\n\nMore\n\n### Subsection\n\n## Section B",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("outline", () => {
  test("returns headings as json", async () => {
    const data = await captureJson(() =>
      outline({ json: true, vault: v.projectPath, file: "doc" }),
    );
    const h = data.headings as { level: number; text: string }[];
    expect(h.length).toBe(4);
    expect(h[0]).toEqual({ level: 1, text: "Title", line: 1 });
    expect(h[1]).toEqual({ level: 2, text: "Section A", line: 5 });
    expect(h[2]).toEqual({ level: 3, text: "Subsection", line: 9 });
    expect(h[3]).toEqual({ level: 2, text: "Section B", line: 11 });
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      outline({ json: true, vault: v.projectPath, file: "doc", total: true }),
    );
    expect(data.total).toBe(4);
  });
});
