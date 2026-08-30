import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { computeFingerprint } from "./fingerprint.js";
import { createTempVault } from "./test-helpers.js";

let vault: { projectPath: string; contentPath: string; cleanup: () => void };

beforeEach(() => {
  vault = createTempVault({
    "README.md": "# Vault\nWelcome",
    "Projects/alpha.md": "# Alpha\nThe alpha project",
    "Projects/beta.md": "# Beta\nBeta project",
  });
});

afterEach(() => {
  vault.cleanup();
});

describe("computeFingerprint", () => {
  test("returns consistent fingerprint for same files", () => {
    const fp1 = computeFingerprint(vault.contentPath);
    const fp2 = computeFingerprint(vault.contentPath);
    expect(fp1).toBe(fp2);
  });

  test("changes when a file is added", () => {
    const fp1 = computeFingerprint(vault.contentPath);
    fs.writeFileSync(path.join(vault.contentPath, "new.md"), "# New");
    const fp2 = computeFingerprint(vault.contentPath);
    expect(fp1).not.toBe(fp2);
  });

  test("changes when a file is modified", () => {
    const fp1 = computeFingerprint(vault.contentPath);
    // Ensure mtime changes (some filesystems have 1s resolution)
    const filePath = path.join(vault.contentPath, "README.md");
    const futureTime = Date.now() + 2000;
    fs.utimesSync(filePath, futureTime / 1000, futureTime / 1000);
    const fp2 = computeFingerprint(vault.contentPath);
    expect(fp1).not.toBe(fp2);
  });

  test("changes when a file is deleted", () => {
    const fp1 = computeFingerprint(vault.contentPath);
    fs.unlinkSync(path.join(vault.contentPath, "README.md"));
    const fp2 = computeFingerprint(vault.contentPath);
    expect(fp1).not.toBe(fp2);
  });
});
