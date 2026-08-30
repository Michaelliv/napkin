import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addTemplate } from "../core/init.js";
import { EXIT_ERROR } from "../utils/exit-codes.js";
import { init } from "./init.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-init-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("init command", () => {
  test("creates .napkin/ with config and .obsidian/ as sibling", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    await init({ json: true, path: tmpDir });
    console.log = orig;

    const data = JSON.parse(logs.join(""));
    expect(data.created).toBe(true);

    // .napkin/ holds config
    expect(fs.existsSync(path.join(tmpDir, ".napkin"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "config.json"))).toBe(
      true,
    );

    // Config has vault.root pointing to parent
    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".napkin", "config.json"), "utf-8"),
    );
    expect(config.vault.root).toBe("..");
    expect(config.vault.obsidian).toBe("../.obsidian");

    // .obsidian/ is sibling to .napkin/
    expect(fs.existsSync(path.join(tmpDir, ".obsidian"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".obsidian", "app.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(tmpDir, ".obsidian", "daily-notes.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".obsidian", "templates.json")),
    ).toBe(true);

    // No .obsidian/ inside .napkin/
    expect(fs.existsSync(path.join(tmpDir, ".napkin", ".obsidian"))).toBe(
      false,
    );
  });

  test("reports not created when already initialized", async () => {
    await init({ quiet: true, path: tmpDir });

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    await init({ json: true, path: tmpDir });
    console.log = orig;

    const data = JSON.parse(logs.join(""));
    expect(data.created).toBe(false);
  });

  test("creates config when only .napkin/ dir exists", async () => {
    fs.mkdirSync(path.join(tmpDir, ".napkin"));

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    await init({ json: true, path: tmpDir });
    console.log = orig;

    const data = JSON.parse(logs.join(""));
    expect(data.created).toBe(false);

    expect(fs.existsSync(path.join(tmpDir, ".napkin", "config.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, ".obsidian"))).toBe(true);
  });

  test("scaffolds template with dirs, files, and NAPKIN.md in project dir", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    await init({ json: true, path: tmpDir, template: "coding" });
    console.log = orig;

    const data = JSON.parse(logs.join(""));
    expect(data.created).toBe(true);
    expect(data.template).toBe("coding");
    expect(data.files).toContain("NAPKIN.md");
    expect(data.files).toContain("decisions/");
    expect(data.files).toContain("guides/");

    // Content in project dir, not .napkin/
    expect(fs.existsSync(path.join(tmpDir, "NAPKIN.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "decisions"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "guides/_about.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Templates/Decision.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, "Templates/Guide.md"))).toBe(true);

    // NOT inside .napkin/
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "NAPKIN.md"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "decisions"))).toBe(
      false,
    );
  });

  test("template on existing vault adds template files", async () => {
    await init({ quiet: true, path: tmpDir });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    await init({ json: true, path: tmpDir, template: "company" });
    console.log = orig;

    const data = JSON.parse(logs.join(""));
    expect(data.template).toBe("company");
    expect(fs.existsSync(path.join(tmpDir, "runbooks"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "NAPKIN.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Templates/Runbook.md"))).toBe(true);
  });

  test("scaffolds all 5 templates", async () => {
    const templates = ["coding", "personal", "research", "company", "product"];
    for (const tmpl of templates) {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), `napkin-tmpl-${tmpl}-`),
      );
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...args: unknown[]) =>
        logs.push(args.map(String).join(" "));
      await init({ json: true, path: dir, template: tmpl });
      console.log = orig;

      const data = JSON.parse(logs.join(""));
      expect(data.created).toBe(true);
      expect(data.template).toBe(tmpl);
      expect(data.files).toContain("NAPKIN.md");
      expect(data.files.length).toBeGreaterThan(3);

      // Content in project dir
      expect(fs.existsSync(path.join(dir, "NAPKIN.md"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "Templates"))).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves existing .obsidian/ content", async () => {
    fs.mkdirSync(path.join(tmpDir, ".obsidian"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".obsidian", "app.json"),
      JSON.stringify({ customSetting: true }),
    );

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    await init({ json: true, path: tmpDir });
    console.log = orig;

    const data = JSON.parse(logs.join(""));
    expect(data.created).toBe(true);

    expect(fs.existsSync(path.join(tmpDir, ".napkin"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "config.json"))).toBe(
      true,
    );

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".napkin", "config.json"), "utf-8"),
    );
    expect(config.vault.root).toBe("..");
    expect(config.vault.obsidian).toBe("../.obsidian");

    // Synced napkin config into existing .obsidian/
    expect(
      fs.existsSync(path.join(tmpDir, ".obsidian", "daily-notes.json")),
    ).toBe(true);

    // Original content preserved
    const appJson = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".obsidian", "app.json"), "utf-8"),
    );
    expect(appJson.customSetting).toBe(true);
    expect(appJson.alwaysUpdateLinks).toBe(true);

    // No .obsidian/ inside .napkin/
    expect(fs.existsSync(path.join(tmpDir, ".napkin", ".obsidian"))).toBe(
      false,
    );
  });

  test("rejects invalid template name", async () => {
    const orig = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error("exit");
    };
    try {
      await init({ json: true, path: tmpDir, template: "doesnotexist" });
    } catch {
      // expected
    }
    (process as any).exit = orig;
    expect(exitCode).toBe(EXIT_ERROR);
  });

  test("addTemplate on existing vault adds dirs and files", async () => {
    await init({ quiet: true, path: tmpDir });

    const result = addTemplate(tmpDir, "coding");
    expect(result.template).toBe("coding");
    expect(result.files).toContain("decisions/");
    expect(result.files).toContain("NAPKIN.md");
    expect(fs.existsSync(path.join(tmpDir, "decisions"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Templates/Decision.md"))).toBe(
      true,
    );
  });

  test("addTemplate composes multiple templates", async () => {
    await init({ quiet: true, path: tmpDir, template: "coding" });

    const result = addTemplate(tmpDir, "company");
    expect(result.template).toBe("company");
    expect(result.files).toContain("runbooks/");
    expect(result.files).not.toContain("NAPKIN.md"); // already exists, skipped
    expect(fs.existsSync(path.join(tmpDir, "runbooks"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Templates/Runbook.md"))).toBe(true);
    // Original coding template files still there
    expect(fs.existsSync(path.join(tmpDir, "decisions"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Templates/Decision.md"))).toBe(
      true,
    );
  });

  test("addTemplate throws on uninitialized vault", () => {
    expect(() => addTemplate(tmpDir, "coding")).toThrow(
      "Vault not initialized",
    );
  });

  test("addTemplate throws on unknown template", async () => {
    await init({ quiet: true, path: tmpDir });
    expect(() => addTemplate(tmpDir, "doesnotexist")).toThrow(
      "Unknown template",
    );
  });

  test("sibling layout is default", async () => {
    await init({ quiet: true, path: tmpDir, template: "coding" });

    // .napkin/ holds config only
    expect(fs.existsSync(path.join(tmpDir, ".napkin"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "config.json"))).toBe(
      true,
    );

    // .obsidian/ is sibling
    expect(fs.existsSync(path.join(tmpDir, ".obsidian"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".obsidian", "app.json"))).toBe(
      true,
    );

    // Content in project dir
    expect(fs.existsSync(path.join(tmpDir, "NAPKIN.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "decisions"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "Templates"))).toBe(true);

    // Nothing inside .napkin/ except config
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "NAPKIN.md"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpDir, ".napkin", "decisions"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpDir, ".napkin", ".obsidian"))).toBe(
      false,
    );
  });
});
