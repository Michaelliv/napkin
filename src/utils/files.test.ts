import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getFileInfo,
  listFiles,
  listFolders,
  readFile,
  resolveFile,
} from "./files.js";
import { createTempVault } from "./test-helpers.js";

let vault: { projectPath: string; contentPath: string; cleanup: () => void };

beforeEach(() => {
  vault = createTempVault({
    "README.md": "# My Vault\nWelcome to the vault.",
    "Projects/Active Projects.md":
      "# Active Projects\n- Project A\n- Project B",
    "Projects/K Logic/Meeting.md": "# Meeting Notes\nSome notes here.",
    "Resources/Runbooks/Deploy.md": "# Deploy\nStep 1\nStep 2",
    "Inbox/Daily/2026-02-24.md":
      "# Daily\n- [ ] Buy groceries\n- [x] Ship feature",
    "Templates/Daily Note.md": "# {{date}}\n\n## Tasks\n- [ ] ",
    "Templates/Meeting Note.md": "# Meeting: {{title}}\n\n## Notes\n",
    "image.png": "fake-png-data",
  });
});

afterEach(() => {
  vault.cleanup();
});

describe("listFiles", () => {
  test("lists all files", () => {
    const files = listFiles(vault.contentPath);
    expect(files.length).toBe(8);
    // Should not include .obsidian files
    for (const f of files) {
      expect(f).not.toMatch(/^\.obsidian\//);
    }
  });

  test("filters by extension", () => {
    const files = listFiles(vault.contentPath, { ext: "md" });
    expect(files.length).toBe(7);
    for (const f of files) {
      expect(f).toEndWith(".md");
    }
  });

  test("filters by folder", () => {
    const files = listFiles(vault.contentPath, { folder: "Projects" });
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(f).toMatch(/^Projects\//);
    }
  });

  test("returns empty for nonexistent folder", () => {
    const files = listFiles(vault.contentPath, { folder: "Nope" });
    expect(files).toEqual([]);
  });
});

describe("listFolders", () => {
  test("lists folders", () => {
    const folders = listFolders(vault.contentPath);
    expect(folders).toContain("Projects");
    expect(folders).toContain("Resources");
    expect(folders).toContain("Templates");
  });

  test("filters by parent folder", () => {
    const folders = listFolders(vault.contentPath, "Resources");
    expect(folders).toEqual(["Resources/Runbooks"]);
  });
});

describe("resolveFile", () => {
  test("resolves by exact path", () => {
    const result = resolveFile(vault.contentPath, "README.md");
    expect(result).toBe("README.md");
  });

  test("resolves by wikilink name", () => {
    const result = resolveFile(vault.contentPath, "Active Projects");
    expect(result).toBe("Projects/Active Projects.md");
  });

  test("resolves case-insensitively", () => {
    const result = resolveFile(vault.contentPath, "active projects");
    expect(result).toBe("Projects/Active Projects.md");
  });

  test("returns null for missing file", () => {
    const result = resolveFile(vault.contentPath, "nonexistent-file");
    expect(result).toBeNull();
  });
});

describe("readFile", () => {
  test("reads file by wikilink name", () => {
    const { path, content } = readFile(vault.contentPath, "README");
    expect(path).toBe("README.md");
    expect(content).toContain("My Vault");
  });

  test("reads file by exact path", () => {
    const { content } = readFile(
      vault.contentPath,
      "Projects/Active Projects.md",
    );
    expect(content).toContain("Project A");
  });

  test("throws for missing file", () => {
    expect(() => readFile(vault.contentPath, "nonexistent")).toThrow(
      "File not found",
    );
  });
});

describe("sibling layout", () => {
  let siblingVault: { path: string; cleanup: () => void };

  beforeEach(() => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "napkin-sibling-files-"),
    );
    // Content at root level
    fs.writeFileSync(path.join(tmpDir, "note.md"), "# Note");
    fs.mkdirSync(path.join(tmpDir, "folder"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "folder", "deep.md"), "# Deep");
    // .napkin/ and .obsidian/ as siblings
    fs.mkdirSync(path.join(tmpDir, ".napkin"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".napkin", "config.json"), "{}");
    siblingVault = {
      path: tmpDir,
      cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  });

  afterEach(() => {
    siblingVault.cleanup();
  });

  test("listFiles skips .napkin/ when content root is parent", () => {
    const files = listFiles(siblingVault.path);
    expect(files).toContain("note.md");
    expect(files).toContain("folder/deep.md");
    // Should NOT include .napkin/ contents
    for (const f of files) {
      expect(f).not.toMatch(/^\.napkin\//);
    }
  });

  test("listFolders skips .napkin/ when content root is parent", () => {
    const folders = listFolders(siblingVault.path);
    expect(folders).toContain("folder");
    expect(folders).not.toContain(".napkin");
  });
});

describe("getFileInfo", () => {
  test("returns file info", () => {
    const info = getFileInfo(vault.contentPath, "README.md");
    expect(info.name).toBe("README");
    expect(info.extension).toBe("md");
    expect(info.size).toBeGreaterThan(0);
    expect(info.created).toBeGreaterThan(0);
    expect(info.modified).toBeGreaterThan(0);
  });
});
