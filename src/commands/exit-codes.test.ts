import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EXIT_NOT_FOUND, EXIT_USER_ERROR } from "../utils/exit-codes.js";
import { createTempVault } from "../utils/test-helpers.js";
import { append, create, del, move, prepend, read, rename } from "./crud.js";
import { file, folder } from "./files.js";
import { backlinks, links } from "./links.js";
import { outline } from "./outline.js";
import { propertyRead, propertyRemove, propertySet } from "./properties.js";
import { task } from "./tasks.js";
import { wordcount } from "./wordcount.js";

let v: ReturnType<typeof createTempVault>;

/**
 * Capture the exit code from a command that calls process.exit.
 */
async function captureExit(fn: () => Promise<void>): Promise<number> {
  const orig = process.exit;
  let exitCode = -1;
  (process as unknown as Record<string, unknown>).exit = (code: number) => {
    exitCode = code;
    throw new Error("exit");
  };
  try {
    await fn();
  } catch {
    // expected — process.exit throws
  }
  (process as unknown as Record<string, unknown>).exit = orig;
  return exitCode;
}

beforeEach(() => {
  v = createTempVault({
    "README.md": "# Vault\nWelcome\n\n- [ ] task one",
    "Projects/note.md": "---\ntitle: Note\n---\nBody",
  });
});

afterEach(() => {
  v.cleanup();
});

// ─── File not found → EXIT_NOT_FOUND ────────────────────────────────

describe("file not found exits with EXIT_NOT_FOUND", () => {
  test("read", async () => {
    const code = await captureExit(() =>
      read("nonexistent", { json: true, vault: v.projectPath }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("append", async () => {
    const code = await captureExit(() =>
      append({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        content: "x",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("prepend", async () => {
    const code = await captureExit(() =>
      prepend({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        content: "x",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("move", async () => {
    const code = await captureExit(() =>
      move({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        to: "dest",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("rename", async () => {
    const code = await captureExit(() =>
      rename({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        name: "new",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("delete", async () => {
    const code = await captureExit(() =>
      del({ json: true, vault: v.projectPath, file: "nonexistent" }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("file info", async () => {
    const code = await captureExit(() =>
      file("nonexistent", { json: true, vault: v.projectPath }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("folder info", async () => {
    const code = await captureExit(() =>
      folder("nonexistent", { json: true, vault: v.projectPath }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("outline", async () => {
    const code = await captureExit(() =>
      outline({ json: true, vault: v.projectPath, file: "nonexistent" }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("wordcount", async () => {
    const code = await captureExit(() =>
      wordcount({ json: true, vault: v.projectPath, file: "nonexistent" }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("backlinks", async () => {
    const code = await captureExit(() =>
      backlinks({ json: true, vault: v.projectPath, file: "nonexistent" }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("links out", async () => {
    const code = await captureExit(() =>
      links({ json: true, vault: v.projectPath, file: "nonexistent" }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("property set", async () => {
    const code = await captureExit(() =>
      propertySet({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        name: "key",
        value: "val",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("property remove", async () => {
    const code = await captureExit(() =>
      propertyRemove({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        name: "key",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("property read", async () => {
    const code = await captureExit(() =>
      propertyRead({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        name: "key",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });
});

// ─── Missing args → EXIT_USER_ERROR ─────────────────────────────────

describe("missing args exits with EXIT_USER_ERROR", () => {
  test("read without file", async () => {
    const code = await captureExit(() =>
      read(undefined, { json: true, vault: v.projectPath }),
    );
    expect(code).toBe(EXIT_USER_ERROR);
  });

  test("append without file", async () => {
    const code = await captureExit(() =>
      append({ json: true, vault: v.projectPath, content: "x" }),
    );
    expect(code).toBe(EXIT_USER_ERROR);
  });

  test("create existing file without overwrite", async () => {
    const code = await captureExit(() =>
      create({ json: true, vault: v.projectPath, name: "README" }),
    );
    expect(code).toBe(EXIT_USER_ERROR);
  });
});

// ─── Task exit codes ────────────────────────────────────────────────

describe("task exit codes", () => {
  test("task with missing file exits EXIT_NOT_FOUND", async () => {
    const code = await captureExit(() =>
      task({
        json: true,
        vault: v.projectPath,
        file: "nonexistent",
        line: "1",
      }),
    );
    expect(code).toBe(EXIT_NOT_FOUND);
  });

  test("task on non-task line exits EXIT_USER_ERROR", async () => {
    const code = await captureExit(() =>
      task({ json: true, vault: v.projectPath, file: "README", line: "1" }),
    );
    expect(code).toBe(EXIT_USER_ERROR);
  });

  test("task without file or ref exits EXIT_USER_ERROR", async () => {
    const code = await captureExit(() =>
      task({ json: true, vault: v.projectPath }),
    );
    expect(code).toBe(EXIT_USER_ERROR);
  });
});
