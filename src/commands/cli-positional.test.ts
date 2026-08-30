import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";

let v: ReturnType<typeof createTempVault>;

beforeEach(() => {
  v = createTempVault({
    "README.md": "# Vault\nWelcome",
    "Projects/note.md": "---\ntitle: Note\n---\nBody content",
  });
});

afterEach(() => {
  v.cleanup();
});

async function run(
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      path.resolve("src/main.ts"),
      "--vault",
      v.projectPath,
      ...args,
    ],
    {
      cwd: v.projectPath,
      stdout: "pipe",
      stderr: "pipe",
      stdin: stdin ? "pipe" : undefined,
    },
  );
  if (stdin && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function readFile(rel: string): string {
  return fs.readFileSync(path.join(v.contentPath, rel), "utf-8");
}

describe("positional args", () => {
  test("create <name>", async () => {
    const { exitCode } = await run(["create", "Test Note", "--json"]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(v.contentPath, "Test Note.md"))).toBe(true);
  });

  test("create <name> [content]", async () => {
    const { exitCode } = await run([
      "create",
      "Test Note",
      "hello world",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    expect(readFile("Test Note.md")).toBe("hello world");
  });

  test("append <file> [content]", async () => {
    const { exitCode } = await run(["append", "README", "new line", "--json"]);
    expect(exitCode).toBe(0);
    expect(readFile("README.md")).toContain("Welcome\nnew line");
  });

  test("append <file> with stdin", async () => {
    const { exitCode } = await run(
      ["append", "README", "--json"],
      "from stdin",
    );
    expect(exitCode).toBe(0);
    expect(readFile("README.md")).toContain("Welcome\nfrom stdin");
  });

  test("append positional content takes precedence over stdin", async () => {
    const { exitCode } = await run(
      ["append", "README", "positional", "--json"],
      "from stdin",
    );
    expect(exitCode).toBe(0);
    expect(readFile("README.md")).toContain("positional");
    expect(readFile("README.md")).not.toContain("from stdin");
  });

  test("prepend <file> [content]", async () => {
    const { exitCode } = await run(["prepend", "README", "top line", "--json"]);
    expect(exitCode).toBe(0);
    const content = readFile("README.md");
    expect(content.indexOf("top line")).toBeLessThan(
      content.indexOf("Welcome"),
    );
  });

  test("prepend <file> with stdin", async () => {
    const { exitCode } = await run(
      ["prepend", "README", "--json"],
      "from stdin",
    );
    expect(exitCode).toBe(0);
    const content = readFile("README.md");
    expect(content.indexOf("from stdin")).toBeLessThan(
      content.indexOf("Welcome"),
    );
  });

  test("move <file> <to>", async () => {
    const { exitCode } = await run(["move", "README", "Projects", "--json"]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(v.contentPath, "Projects/README.md"))).toBe(
      true,
    );
  });

  test("rename <file> <name>", async () => {
    const { exitCode } = await run(["rename", "README", "INDEX", "--json"]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(v.contentPath, "INDEX.md"))).toBe(true);
  });

  test("delete <file>", async () => {
    const { exitCode } = await run([
      "delete",
      "README",
      "--permanent",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(v.contentPath, "README.md"))).toBe(false);
  });

  test("file outline <file>", async () => {
    const { stdout, exitCode } = await run([
      "file",
      "outline",
      "README",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.headings.length).toBeGreaterThan(0);
  });

  test("file wordcount <file>", async () => {
    const { stdout, exitCode } = await run([
      "file",
      "wordcount",
      "README",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.words).toBeGreaterThan(0);
  });

  test("daily append [content]", async () => {
    // Create today's daily note first
    await run(["daily", "today", "--json"]);
    const { exitCode } = await run([
      "daily",
      "append",
      "daily entry",
      "--json",
    ]);
    expect(exitCode).toBe(0);
  });

  test("daily prepend [content]", async () => {
    await run(["daily", "today", "--json"]);
    const { exitCode } = await run(["daily", "prepend", "top entry", "--json"]);
    expect(exitCode).toBe(0);
  });
});

describe("flag backward compat", () => {
  test("append --file --content still works", async () => {
    const { exitCode } = await run([
      "append",
      "--file",
      "README",
      "--content",
      "flag content",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    expect(readFile("README.md")).toContain("flag content");
  });

  test("create --name --content still works", async () => {
    const { exitCode } = await run([
      "create",
      "--name",
      "Flag Note",
      "--content",
      "flag body",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    expect(readFile("Flag Note.md")).toBe("flag body");
  });
});
