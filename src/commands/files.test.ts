import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { file, files, folders } from "./files.js";

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
    "README.md": "# Vault",
    "Projects/note.md": "note content",
    "Resources/guide.md": "guide",
    "image.png": "fake",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("file command", () => {
  test("shows file info as json", async () => {
    const data = await captureJson(() =>
      file("README", { json: true, vault: v.projectPath }),
    );
    expect(data.name).toBe("README");
    expect(data.extension).toBe("md");
    expect(data.size).toBeGreaterThan(0);
  });
});

describe("files command", () => {
  test("lists all files", async () => {
    const data = await captureJson(() =>
      files({ json: true, vault: v.projectPath }),
    );
    expect((data.files as string[]).length).toBe(4);
  });

  test("filters by extension", async () => {
    const data = await captureJson(() =>
      files({ json: true, vault: v.projectPath, ext: "md" }),
    );
    expect((data.files as string[]).length).toBe(3);
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      files({ json: true, vault: v.projectPath, total: true }),
    );
    expect(data.total).toBe(4);
  });
});

describe("folders command", () => {
  test("lists folders", async () => {
    const data = await captureJson(() =>
      folders({ json: true, vault: v.projectPath }),
    );
    expect(data.folders).toContain("Projects");
    expect(data.folders).toContain("Resources");
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      folders({ json: true, vault: v.projectPath, total: true }),
    );
    expect(data.total).toBe(2);
  });
});
