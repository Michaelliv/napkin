import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";
import { append, create, del, move, prepend, read, rename } from "./crud.js";

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
    "README.md": "# Vault\nWelcome",
    "Projects/note.md": "---\ntitle: Note\n---\nBody content",
    "Templates/Daily Note.md": "# {{date}}\n\n## Tasks\n",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("read", () => {
  test("reads file content", async () => {
    const data = await captureJson(() =>
      read("README", { json: true, vault: v.projectPath }),
    );
    expect(data.content).toContain("Welcome");
  });
});

describe("create", () => {
  test("creates a new file", async () => {
    const data = await captureJson(() =>
      create({
        json: true,
        vault: v.projectPath,
        name: "New Note",
        content: "Hello",
      }),
    );
    expect(data.created).toBe(true);
    const content = fs.readFileSync(
      path.join(v.contentPath, "New Note.md"),
      "utf-8",
    );
    expect(content).toBe("Hello");
  });

  test("creates from template", async () => {
    const data = await captureJson(() =>
      create({
        json: true,
        vault: v.projectPath,
        name: "Today",
        template: "Daily Note",
      }),
    );
    expect(data.created).toBe(true);
    const content = fs.readFileSync(
      path.join(v.contentPath, "Today.md"),
      "utf-8",
    );
    expect(content).toContain("{{date}}");
  });

  test("creates with path in subfolder", async () => {
    await captureJson(() =>
      create({
        json: true,
        vault: v.projectPath,
        path: "Archive/old-note",
        content: "archived",
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "Archive/old-note.md"),
      "utf-8",
    );
    expect(content).toBe("archived");
  });
});

describe("append", () => {
  test("appends content to file", async () => {
    await captureJson(() =>
      append({
        json: true,
        vault: v.projectPath,
        file: "README",
        content: "New line",
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "README.md"),
      "utf-8",
    );
    expect(content).toContain("Welcome\nNew line");
  });

  test("appends inline without newline", async () => {
    await captureJson(() =>
      append({
        json: true,
        vault: v.projectPath,
        file: "README",
        content: " extra",
        inline: true,
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "README.md"),
      "utf-8",
    );
    expect(content).toContain("Welcome extra");
  });
});

describe("prepend", () => {
  test("prepends after frontmatter", async () => {
    await captureJson(() =>
      prepend({
        json: true,
        vault: v.projectPath,
        file: "Projects/note.md",
        content: "Prepended",
      }),
    );
    const content = fs.readFileSync(
      path.join(v.contentPath, "Projects/note.md"),
      "utf-8",
    );
    expect(content).toContain("title: Note");
    // Prepended should come before Body content
    const prependIdx = content.indexOf("Prepended");
    const bodyIdx = content.indexOf("Body content");
    expect(prependIdx).toBeLessThan(bodyIdx);
  });
});

describe("move", () => {
  test("moves file to new folder", async () => {
    await captureJson(() =>
      move({ json: true, vault: v.projectPath, file: "README", to: "Archive" }),
    );
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(v.contentPath, "Archive/README.md"))).toBe(
      true,
    );
  });
});

describe("rename", () => {
  test("renames a file", async () => {
    await captureJson(() =>
      rename({
        json: true,
        vault: v.projectPath,
        file: "README",
        name: "INDEX",
      }),
    );
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(v.contentPath, "INDEX.md"))).toBe(true);
  });
});

describe("delete", () => {
  test("moves file to .trash by default", async () => {
    await captureJson(() =>
      del({ json: true, vault: v.projectPath, file: "README" }),
    );
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(v.contentPath, ".trash/README.md"))).toBe(
      true,
    );
  });

  test("permanently deletes with --permanent", async () => {
    await captureJson(() =>
      del({
        json: true,
        vault: v.projectPath,
        file: "README",
        permanent: true,
      }),
    );
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(v.contentPath, ".trash/README.md"))).toBe(
      false,
    );
  });
});
