import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";
import { findVault } from "../utils/vault.js";
import {
  appendFile,
  createFile,
  deleteFile,
  moveFile,
  prependFile,
  readFile,
  renameFile,
} from "./crud.js";
import { ensureDaily, readDaily } from "./daily.js";
import { getFileInfoResolved, getFolderInfo } from "./files.js";
import { initVault } from "./init.js";
import { getOutline } from "./outline.js";
import { readProperty, removeProperty, setProperty } from "./properties.js";
import { showTask, updateTask } from "./tasks.js";
import { getWordCount } from "./wordcount.js";

let v: ReturnType<typeof createTempVault>;

beforeEach(() => {
  v = createTempVault({
    "README.md": "# Vault\nWelcome\n\n- [ ] task one\n- [x] task two",
    "Projects/note.md":
      "---\ntitle: Note\ntags:\n  - project\n---\nBody content",
    "Templates/Daily Note.md": "# {{date}}\n\n## Tasks\n",
  });
});

afterEach(() => {
  v.cleanup();
});

// ─── Core functions throw on file not found ─────────────────────────

describe("core throws on file not found", () => {
  test("readFile throws with prefix", () => {
    expect(() => readFile(v.contentPath, "nonexistent")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("appendFile throws with prefix", () => {
    expect(() => appendFile(v.contentPath, "nonexistent", "text")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("prependFile throws with prefix", () => {
    expect(() => prependFile(v.contentPath, "nonexistent", "text")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("moveFile throws with prefix", () => {
    expect(() => moveFile(v.contentPath, "nonexistent", "dest")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("renameFile throws with prefix", () => {
    expect(() => renameFile(v.contentPath, "nonexistent", "new")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("deleteFile throws with prefix", () => {
    expect(() => deleteFile(v.contentPath, "nonexistent")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("getFileInfoResolved throws with prefix", () => {
    expect(() => getFileInfoResolved(v.contentPath, "nonexistent")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("getFolderInfo throws with prefix", () => {
    expect(() => getFolderInfo(v.contentPath, "nonexistent")).toThrow(
      "Folder not found: nonexistent",
    );
  });

  test("getOutline throws with prefix", () => {
    expect(() => getOutline(v.contentPath, "nonexistent")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("getWordCount throws with prefix", () => {
    expect(() => getWordCount(v.contentPath, "nonexistent")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("setProperty throws with prefix", () => {
    expect(() =>
      setProperty(v.contentPath, "nonexistent", "key", "val"),
    ).toThrow("File not found: nonexistent");
  });

  test("removeProperty throws with prefix", () => {
    expect(() => removeProperty(v.contentPath, "nonexistent", "key")).toThrow(
      "File not found: nonexistent",
    );
  });

  test("readProperty throws with prefix", () => {
    expect(() => readProperty(v.contentPath, "nonexistent", "key")).toThrow(
      "File not found: nonexistent",
    );
  });
});

// ─── Core functions never import output or call console/process ─────

describe("core module purity", () => {
  test("no core file imports from utils/output", async () => {
    const coreDir = path.join(__dirname);
    const coreFiles = fs
      .readdirSync(coreDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of coreFiles) {
      const content = fs.readFileSync(path.join(coreDir, file), "utf-8");
      expect(content).not.toContain("utils/output");
    }
  });

  test("no core file calls console.log or process.exit", async () => {
    const coreDir = path.join(__dirname);
    const coreFiles = fs
      .readdirSync(coreDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of coreFiles) {
      const content = fs.readFileSync(path.join(coreDir, file), "utf-8");
      expect(content).not.toContain("console.log");
      expect(content).not.toContain("console.error");
      expect(content).not.toContain("process.exit");
    }
  });
});

// ─── createFile ─────────────────────────────────────────────────────

describe("createFile", () => {
  test("throws on existing file without overwrite", () => {
    const vault = findVault(v.projectPath);
    expect(() => createFile(vault, { name: "README" })).toThrow(
      "File already exists",
    );
  });

  test("throws on invalid template", () => {
    const vault = findVault(v.projectPath);
    expect(() =>
      createFile(vault, { name: "Test", template: "nonexistent" }),
    ).toThrow("Template not found: nonexistent");
  });
});

// ─── ensureDaily returns correct created flag ───────────────────────

describe("ensureDaily", () => {
  test("returns created: true when daily note does not exist", () => {
    const vault = findVault(v.projectPath);
    const result = ensureDaily(vault);
    expect(result.created).toBe(true);
    expect(result.path).toBeTruthy();
  });

  test("returns created: false when daily note already exists", () => {
    const vault = findVault(v.projectPath);
    ensureDaily(vault); // create it
    const result = ensureDaily(vault); // call again
    expect(result.created).toBe(false);
  });
});

// ─── readDaily throws when missing ──────────────────────────────────

describe("readDaily", () => {
  test("throws when daily note does not exist", () => {
    const vault = findVault(v.projectPath);
    expect(() => readDaily(vault)).toThrow("Daily note not found");
  });

  test("returns content after ensureDaily", () => {
    const vault = findVault(v.projectPath);
    ensureDaily(vault);
    const result = readDaily(vault);
    expect(result.path).toBeTruthy();
    expect(typeof result.content).toBe("string");
  });
});

// ─── initVault ──────────────────────────────────────────────────────

describe("initVault", () => {
  test("throws without path", () => {
    expect(() => initVault({})).toThrow("No path specified");
  });

  test("returns configCreated and siblingLayout fields", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(require("node:os").tmpdir(), "napkin-init-core-"),
    );
    try {
      const result = initVault({ path: tmpDir, template: "coding" });
      expect(result.status).toBe("created");
      expect(typeof result.configCreated).toBe("boolean");
      expect(typeof result.siblingLayout).toBe("boolean");
      expect(result.configCreated).toBe(true);
      expect(result.siblingLayout).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns status exists on second init", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(require("node:os").tmpdir(), "napkin-init-core-"),
    );
    try {
      initVault({ path: tmpDir });
      const result = initVault({ path: tmpDir });
      expect(result.status).toBe("exists");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("throws on invalid template", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(require("node:os").tmpdir(), "napkin-init-core-"),
    );
    try {
      expect(() =>
        initVault({ path: tmpDir, template: "doesnotexist" }),
      ).toThrow("Unknown template");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── showTask / updateTask ──────────────────────────────────────────

describe("showTask", () => {
  test("returns current status and text", () => {
    const result = showTask(v.contentPath, "README.md", 4);
    expect(result.currentStatus).toBe(" ");
    expect(result.text).toBe("task one");
  });

  test("throws on non-task line", () => {
    expect(() => showTask(v.contentPath, "README.md", 1)).toThrow(
      "is not a task",
    );
  });

  test("throws on missing line", () => {
    expect(() => showTask(v.contentPath, "README.md", 999)).toThrow(
      "not found in",
    );
  });

  test("throws on missing file", () => {
    expect(() => showTask(v.contentPath, "nope.md", 1)).toThrow(
      "File not found",
    );
  });
});

describe("updateTask", () => {
  test("writes new status to file", () => {
    const result = updateTask(v.contentPath, "README.md", 4, "x");
    expect(result.status).toBe("x");
    expect(result.text).toBe("task one");

    const content = fs.readFileSync(
      path.join(v.contentPath, "README.md"),
      "utf-8",
    );
    expect(content).toContain("- [x] task one");
  });
});

// ─── property operations ────────────────────────────────────────────

describe("property operations", () => {
  test("setProperty parses boolean values", () => {
    const result = setProperty(
      v.contentPath,
      "Projects/note.md",
      "draft",
      "true",
    );
    expect(result.value).toBe(true);
  });

  test("setProperty parses number values", () => {
    const result = setProperty(
      v.contentPath,
      "Projects/note.md",
      "priority",
      "42",
    );
    expect(result.value).toBe(42);
  });

  test("readProperty returns null for missing property", () => {
    const result = readProperty(
      v.contentPath,
      "Projects/note.md",
      "nonexistent",
    );
    expect(result.value).toBeNull();
  });

  test("removeProperty returns removed key", () => {
    const result = removeProperty(v.contentPath, "Projects/note.md", "title");
    expect(result.removed).toBe("title");

    const check = readProperty(v.contentPath, "Projects/note.md", "title");
    expect(check.value).toBeNull();
  });
});
