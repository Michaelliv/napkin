import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDailyPath } from "../core/daily.js";
import { createTempVault } from "../utils/test-helpers.js";
import { dailyAppend, dailyPath, dailyPrepend, dailyRead } from "./daily.js";

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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeEach(() => {
  v = createTempVault({
    [`Inbox/Daily/${todayStr()}.md`]: "# Today\n- [ ] Task 1\n- [x] Task 2",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("getDailyPath", () => {
  test("returns path based on config", () => {
    const dp = getDailyPath(v.contentPath);
    expect(dp).toBe(`Inbox/Daily/${todayStr()}.md`);
  });

  test("formats custom date", () => {
    const dp = getDailyPath(v.contentPath, new Date(2026, 0, 15));
    expect(dp).toBe("Inbox/Daily/2026-01-15.md");
  });
});

describe("dailyPath", () => {
  test("outputs path as json", async () => {
    const data = await captureJson(() =>
      dailyPath({ json: true, vault: v.projectPath }),
    );
    expect(data.path).toBe(`Inbox/Daily/${todayStr()}.md`);
  });
});

describe("dailyRead", () => {
  test("reads daily note content", async () => {
    const data = await captureJson(() =>
      dailyRead({ json: true, vault: v.projectPath }),
    );
    expect(data.content).toContain("Task 1");
  });
});

describe("dailyAppend", () => {
  test("appends to daily note", async () => {
    await captureJson(() =>
      dailyAppend({
        json: true,
        vault: v.projectPath,
        content: "- [ ] New task",
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, `Inbox/Daily/${todayStr()}.md`),
      "utf-8",
    );
    expect(content).toContain("New task");
  });

  test("creates daily note if missing then appends", async () => {
    // Remove existing daily
    fs.unlinkSync(path.join(v.contentPath, `Inbox/Daily/${todayStr()}.md`));
    await captureJson(() =>
      dailyAppend({ json: true, vault: v.projectPath, content: "First entry" }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, `Inbox/Daily/${todayStr()}.md`),
      "utf-8",
    );
    expect(content).toContain("First entry");
  });
});

describe("dailyPrepend", () => {
  test("prepends to daily note", async () => {
    await captureJson(() =>
      dailyPrepend({ json: true, vault: v.projectPath, content: "Top line" }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, `Inbox/Daily/${todayStr()}.md`),
      "utf-8",
    );
    const topIdx = content.indexOf("Top line");
    const taskIdx = content.indexOf("Task 1");
    expect(topIdx).toBeLessThan(taskIdx);
  });
});
