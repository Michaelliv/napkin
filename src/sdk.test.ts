import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Napkin } from "./sdk.js";
import { createTempVault } from "./utils/test-helpers.js";

let v: ReturnType<typeof createTempVault>;
let n: Napkin;

beforeEach(() => {
  v = createTempVault({
    "README.md":
      "# Vault\nWelcome to the vault\n\n- [ ] task one\n- [x] task two\n\n#tag1 #tag2\n\n[[Projects/note]]",
    "Projects/note.md":
      "---\ntitle: Note\ntags:\n  - project\naliases:\n  - my-note\n---\n# Project Note\n\nBody content\n\n[[README]]",
    "Templates/Daily Note.md": "# {{date}}\n\n## Tasks\n",
  });
  n = new Napkin(v.projectPath);
});

afterEach(() => {
  v.cleanup();
});

// ── Vault ─────────────────────────────────────────────────────────

describe("vault info", () => {
  test("info returns vault metadata", () => {
    const meta = n.info();
    expect(meta.name).toBeTruthy();
    expect(meta.files).toBeGreaterThan(0);
    expect(meta.folders).toBeGreaterThanOrEqual(0);
    expect(typeof meta.size).toBe("number");
  });

  test("overview returns folders with keywords", () => {
    const result = n.overview();
    expect(result.overview.length).toBeGreaterThan(0);
    expect(result.overview[0].notes).toBeGreaterThan(0);
  });
});

// ── Search ────────────────────────────────────────────────────────

describe("search", () => {
  test("finds content by query", () => {
    const results = n.search("vault");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBeTruthy();
  });

  test("returns empty for no match", () => {
    const results = n.search("zzzznonexistentzzzz");
    expect(results.length).toBe(0);
  });
});

// ── CRUD ──────────────────────────────────────────────────────────

describe("crud", () => {
  test("read returns file content", () => {
    const result = n.read("README");
    expect(result.content).toContain("Welcome");
    expect(result.path).toBe("README.md");
  });

  test("read throws on missing file", () => {
    expect(() => n.read("nonexistent")).toThrow("File not found");
  });

  test("create and read back", () => {
    const created = n.create({ name: "Test", content: "hello" });
    expect(created.created).toBe(true);
    const read = n.read("Test");
    expect(read.content).toBe("hello");
  });

  test("append adds content", () => {
    n.append("README", "\nAppended line");
    const result = n.read("README");
    expect(result.content).toContain("Appended line");
  });

  test("prepend adds content before body", () => {
    n.prepend("Projects/note.md", "Prepended");
    const result = n.read("Projects/note.md");
    const prepIdx = result.content.indexOf("Prepended");
    const bodyIdx = result.content.indexOf("Body content");
    expect(prepIdx).toBeLessThan(bodyIdx);
  });

  test("move relocates file", () => {
    const result = n.move("README", "Archive");
    expect(result.from).toBe("README.md");
    expect(result.to).toContain("Archive");
    // File is now at Archive/README.md — resolves by basename
    const moved = n.read("README");
    expect(moved.path).toBe("Archive/README.md");
  });

  test("rename changes filename", () => {
    n.create({ name: "ToRename", content: "x" });
    const result = n.rename("ToRename", "Renamed");
    expect(result.to).toContain("Renamed.md");
  });

  test("delete moves to trash", () => {
    n.create({ name: "ToDelete", content: "x" });
    const result = n.delete("ToDelete");
    expect(result.deleted).toBe(true);
    expect(result.permanent).toBe(false);
  });
});

// ── Files ─────────────────────────────────────────────────────────

describe("files", () => {
  test("fileList returns all files", () => {
    const files = n.fileList();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("README.md");
  });

  test("fileInfo returns metadata", () => {
    const info = n.fileInfo("README");
    expect(info.name).toBe("README");
    expect(info.extension).toBe("md");
    expect(info.size).toBeGreaterThan(0);
  });

  test("folders returns folder list", () => {
    const folders = n.folders();
    expect(folders).toContain("Projects");
  });

  test("folderInfo returns counts", () => {
    const info = n.folderInfo("Projects");
    expect(info.files).toBeGreaterThan(0);
  });

  test("outline returns headings", () => {
    const headings = n.outline("Projects/note.md");
    expect(headings.length).toBe(1);
    expect(headings[0].text).toBe("Project Note");
  });

  test("wordcount returns counts", () => {
    const wc = n.wordcount("README");
    expect(wc.words).toBeGreaterThan(0);
    expect(wc.characters).toBeGreaterThan(0);
  });
});

// ── Daily ─────────────────────────────────────────────────────────

describe("daily", () => {
  test("dailyPath returns a path", () => {
    const dp = n.dailyPath();
    expect(dp).toContain(".md");
  });

  test("dailyEnsure creates note", () => {
    const result = n.dailyEnsure();
    expect(result.created).toBe(true);
    const second = n.dailyEnsure();
    expect(second.created).toBe(false);
  });

  test("dailyRead works after ensure", () => {
    n.dailyEnsure();
    const result = n.dailyRead();
    expect(typeof result.content).toBe("string");
  });

  test("dailyAppend adds content", () => {
    n.dailyEnsure();
    n.dailyAppend("- test item");
    const result = n.dailyRead();
    expect(result.content).toContain("- test item");
  });
});

// ── Tags ──────────────────────────────────────────────────────────

describe("tags", () => {
  test("tags returns tag counts", () => {
    const data = n.tags();
    expect(data.tagCounts.size).toBeGreaterThan(0);
  });

  test("tagInfo returns info for a tag", () => {
    const info = n.tagInfo("project");
    expect(info.count).toBe(1);
    expect(info.files.length).toBe(1);
  });
});

// ── Aliases ───────────────────────────────────────────────────────

describe("aliases", () => {
  test("returns aliases from vault", () => {
    const result = n.aliases();
    expect(result.length).toBe(1);
    expect(result[0].alias).toBe("my-note");
  });
});

// ── Properties ────────────────────────────────────────────────────

describe("properties", () => {
  test("lists properties across vault", () => {
    const props = n.properties();
    expect(props.has("title")).toBe(true);
  });

  test("get/set/remove cycle", () => {
    n.propertySet("Projects/note.md", "draft", "true");
    const result = n.propertyGet("Projects/note.md", "draft");
    expect(result.value).toBe(true);

    n.propertyRemove("Projects/note.md", "draft");
    const after = n.propertyGet("Projects/note.md", "draft");
    expect(after.value).toBeNull();
  });
});

// ── Tasks ─────────────────────────────────────────────────────────

describe("tasks", () => {
  test("lists all tasks", () => {
    const all = n.tasks();
    expect(all.length).toBe(2);
  });

  test("filters todo tasks", () => {
    const todo = n.tasks({ todo: true });
    expect(todo.length).toBe(1);
    expect(todo[0].text).toBe("task one");
  });

  test("show and update task", () => {
    const info = n.taskShow("README.md", 4);
    expect(info.currentStatus).toBe(" ");

    const updated = n.taskUpdate("README.md", 4, "x");
    expect(updated.status).toBe("x");
  });
});

// ── Links ─────────────────────────────────────────────────────────

describe("links", () => {
  test("linksOut returns outgoing links", () => {
    const out = n.linksOut("README");
    expect(out.length).toBeGreaterThan(0);
  });

  test("linksBack returns backlinks", () => {
    const back = n.linksBack("README");
    expect(back.length).toBeGreaterThan(0);
  });

  test("orphans and deadends return arrays", () => {
    expect(Array.isArray(n.orphans())).toBe(true);
    expect(Array.isArray(n.deadends())).toBe(true);
  });
});

// ── Templates ─────────────────────────────────────────────────────

describe("templates", () => {
  test("lists templates", () => {
    const list = n.templates();
    expect(list).toContain("Daily Note");
  });

  test("reads template content", () => {
    const result = n.templateRead("Daily Note");
    expect(result.content).toContain("{{date}}");
  });

  test("reads template with variables resolved", () => {
    const result = n.templateRead("Daily Note", { resolve: true });
    expect(result.content).not.toContain("{{date}}");
  });
});

// ── Config ────────────────────────────────────────────────────────

describe("config", () => {
  test("returns full config", () => {
    const cfg = n.config();
    expect(cfg).toHaveProperty("search");
  });

  test("get and set", () => {
    n.configSet("search.limit", "50");
    const val = n.configGet("search.limit");
    expect(val).toBe(50);
  });
});

// ── Bookmarks ─────────────────────────────────────────────────────

describe("bookmarks", () => {
  test("starts empty", () => {
    const list = n.bookmarks();
    expect(list.length).toBe(0);
  });

  test("add and list", () => {
    n.bookmarkAdd({ type: "file", path: "README.md" });
    const list = n.bookmarks();
    expect(list.length).toBe(1);
    expect(list[0].path).toBe("README.md");
  });
});

// ── Canvas ────────────────────────────────────────────────────────

describe("canvas", () => {
  test("create, add node, read", () => {
    n.canvasCreate("test");
    const node = n.canvasAddNode("test", { type: "text", text: "Hello" });
    expect(node.added).toBe(true);

    const { canvas } = n.canvasRead("test");
    expect(canvas.nodes.length).toBe(1);
    expect(canvas.nodes[0].text).toBe("Hello");
  });
});

// ── Static methods ────────────────────────────────────────────────

describe("static", () => {
  test("templates returns template list", () => {
    const templates = Napkin.vaultTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].name).toBeTruthy();
  });

  test("scaffold creates a vault", () => {
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-sdk-"));
    try {
      const result = Napkin.scaffold(tmpDir);
      expect(result.created).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".napkin"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("scaffold with template creates dirs and files", () => {
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-sdk-"));
    try {
      const result = Napkin.scaffold(tmpDir, { template: "coding" });
      expect(result.created).toBe(true);
      expect(result.template).toBe("coding");
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(tmpDir, "decisions"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("scaffold is idempotent", () => {
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-sdk-"));
    try {
      const first = Napkin.scaffold(tmpDir);
      const second = Napkin.scaffold(tmpDir);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("constructor auto-creates vault", () => {
    const os = require("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-sdk-"));
    try {
      const n = new Napkin(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, ".napkin"))).toBe(true);
      expect(n.vault.contentPath).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
