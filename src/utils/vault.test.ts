import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createTempVault } from "./test-helpers.js";
import { findVault } from "./vault.js";

let vault: { projectPath: string; contentPath: string; cleanup: () => void };

beforeEach(() => {
  vault = createTempVault();
});

afterEach(() => {
  vault.cleanup();
});

describe("findVault", () => {
  test("finds vault from project root", () => {
    const result = findVault(vault.projectPath);
    expect(result.configPath).toBe(path.join(vault.projectPath, ".napkin"));
  });

  test("finds vault from subdirectory", () => {
    const sub = path.join(vault.projectPath, "some", "nested", "dir");
    fs.mkdirSync(sub, { recursive: true });
    const result = findVault(sub);
    expect(result.configPath).toBe(path.join(vault.projectPath, ".napkin"));
  });

  test("auto-creates vault when none found", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-auto-"));
    try {
      const result = findVault(tmpDir);
      expect(result.contentPath).toBe(tmpDir);
      expect(result.configPath).toBe(path.join(tmpDir, ".napkin"));
      expect(result.obsidianPath).toBe(path.join(tmpDir, ".obsidian"));
      expect(fs.existsSync(path.join(tmpDir, ".napkin", "config.json"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(tmpDir, "NAPKIN.md"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".obsidian"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("finds vault with .napkin/ directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-only-test-"));
    fs.mkdirSync(path.join(tmpDir, ".napkin"));
    try {
      const result = findVault(tmpDir);
      expect(result.configPath).toBe(path.join(tmpDir, ".napkin"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("layout: embedded (.napkin/.obsidian/)", () => {
    test("contentPath is .napkin/, obsidianPath is .napkin/.obsidian/", () => {
      const result = findVault(vault.projectPath);
      expect(result.contentPath).toBe(path.join(vault.projectPath, ".napkin"));
      expect(result.configPath).toBe(path.join(vault.projectPath, ".napkin"));
      expect(result.obsidianPath).toBe(
        path.join(vault.projectPath, ".napkin", ".obsidian"),
      );
    });

    test("existing config without vault field resolves as embedded", () => {
      // Simulate a pre-existing vault: config.json has no vault field
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "napkin-existing-test-"),
      );
      const napkinDir = path.join(tmpDir, ".napkin");
      fs.mkdirSync(path.join(napkinDir, ".obsidian"), { recursive: true });
      fs.writeFileSync(
        path.join(napkinDir, "config.json"),
        JSON.stringify({
          overview: { depth: 3, keywords: 8 },
          daily: { folder: "daily", format: "YYYY-MM-DD" },
        }),
      );
      fs.writeFileSync(path.join(napkinDir, "README.md"), "# Hello");

      try {
        const result = findVault(tmpDir);
        expect(result.contentPath).toBe(napkinDir);
        expect(result.configPath).toBe(napkinDir);
        expect(result.obsidianPath).toBe(path.join(napkinDir, ".obsidian"));
        expect(result.name).toBe(path.basename(tmpDir));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("layout: sibling (.napkin/ alongside .obsidian/)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-sibling-test-"));
      // Existing Obsidian vault with .obsidian/ at root
      fs.mkdirSync(path.join(tmpDir, ".obsidian"), { recursive: true });
      // napkin adopted — .napkin/ as sibling
      fs.mkdirSync(path.join(tmpDir, ".napkin"), { recursive: true });
      // config tells napkin the layout
      fs.writeFileSync(
        path.join(tmpDir, ".napkin", "config.json"),
        JSON.stringify({ vault: { root: "..", obsidian: "../.obsidian" } }),
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("contentPath is parent dir, obsidianPath is sibling .obsidian/", () => {
      const result = findVault(tmpDir);
      expect(result.contentPath).toBe(tmpDir);
      expect(result.configPath).toBe(path.join(tmpDir, ".napkin"));
      expect(result.obsidianPath).toBe(path.join(tmpDir, ".obsidian"));
    });

    test("finds vault from subdirectory", () => {
      const sub = path.join(tmpDir, "notes", "deep");
      fs.mkdirSync(sub, { recursive: true });
      const result = findVault(sub);
      expect(result.contentPath).toBe(tmpDir);
    });
  });

  describe("layout: nested (.obsidian/.napkin/)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-nested-test-"));
      // Existing Obsidian vault
      fs.mkdirSync(path.join(tmpDir, ".obsidian", ".napkin"), {
        recursive: true,
      });
      // config inside .obsidian/.napkin/
      fs.writeFileSync(
        path.join(tmpDir, ".obsidian", ".napkin", "config.json"),
        JSON.stringify({ vault: { root: "../..", obsidian: ".." } }),
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("contentPath is grandparent, obsidianPath is parent .obsidian/", () => {
      const result = findVault(tmpDir);
      expect(result.contentPath).toBe(tmpDir);
      expect(result.configPath).toBe(path.join(tmpDir, ".obsidian", ".napkin"));
      expect(result.obsidianPath).toBe(path.join(tmpDir, ".obsidian"));
    });
  });
});
