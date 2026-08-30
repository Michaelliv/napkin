import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";
import { task, tasks } from "./tasks.js";

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
    "note.md":
      "# Note\n- [ ] Buy groceries\n- [x] Ship feature\n- [-] Cancelled",
    "other.md": "# Other\n- [ ] Other task",
    [`Inbox/Daily/${todayStr()}.md`]:
      "# Today\n- [ ] Daily task\n- [x] Done daily",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("tasks", () => {
  test("lists all tasks", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath }),
    );
    expect((data.tasks as unknown[]).length).toBe(6);
  });

  test("filters todo only", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath, todo: true }),
    );
    const t = data.tasks as { done: boolean }[];
    expect(t.every((x) => !x.done)).toBe(true);
  });

  test("filters done only", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath, done: true }),
    );
    const t = data.tasks as { done: boolean }[];
    expect(t.every((x) => x.done)).toBe(true);
  });

  test("filters by file", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath, file: "note" }),
    );
    expect((data.tasks as unknown[]).length).toBe(3);
  });

  test("filters daily tasks", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath, daily: true }),
    );
    expect((data.tasks as unknown[]).length).toBe(2);
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath, total: true }),
    );
    expect(data.total).toBe(6);
  });

  test("filters by status char", async () => {
    const data = await captureJson(() =>
      tasks({ json: true, vault: v.projectPath, status: "-" }),
    );
    const t = data.tasks as { status: string }[];
    expect(t.length).toBe(1);
    expect(t[0].status).toBe("-");
  });
});

describe("task", () => {
  test("shows task info", async () => {
    const data = await captureJson(() =>
      task({ json: true, vault: v.projectPath, file: "note", line: "2" }),
    );
    expect(data.status).toBe(" ");
    expect(data.text).toBe("Buy groceries");
  });

  test("toggles task", async () => {
    await captureJson(() =>
      task({
        json: true,
        vault: v.projectPath,
        file: "note",
        line: "2",
        toggle: true,
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "note.md"),
      "utf-8",
    );
    expect(content).toContain("[x] Buy groceries");
  });

  test("marks task done", async () => {
    await captureJson(() =>
      task({
        json: true,
        vault: v.projectPath,
        file: "note",
        line: "2",
        done: true,
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "note.md"),
      "utf-8",
    );
    expect(content).toContain("[x] Buy groceries");
  });

  test("marks task todo", async () => {
    await captureJson(() =>
      task({
        json: true,
        vault: v.projectPath,
        file: "note",
        line: "3",
        todo: true,
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "note.md"),
      "utf-8",
    );
    expect(content).toContain("[ ] Ship feature");
  });

  test("uses ref format", async () => {
    const data = await captureJson(() =>
      task({ json: true, vault: v.projectPath, ref: "note.md:2" }),
    );
    expect(data.text).toBe("Buy groceries");
  });
});
