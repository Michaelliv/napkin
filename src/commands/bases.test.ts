import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { baseQuery, bases, baseViews } from "./bases.js";

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
    "Projects/alpha.md": "---\ntitle: Alpha\nstatus: active\n---\n# Alpha",
    "Projects/beta.md": "---\ntitle: Beta\nstatus: done\n---\n# Beta",
    "Notes/random.md": "---\ntitle: Random\n---\n# Random",
    "projects.base":
      'filters:\n  file.inFolder("Projects")\nviews:\n  - type: table\n    name: "All Projects"\n  - type: table\n    name: "Active"\n    filters:\n      \'status == "active"\'',
  });
});

afterEach(() => {
  v.cleanup();
});

describe("bases", () => {
  test("lists .base files", async () => {
    const data = await captureJson(() =>
      bases({ json: true, vault: v.projectPath }),
    );
    const b = data.bases as string[];
    expect(b).toContain("projects.base");
  });
});

describe("baseViews", () => {
  test("lists views in a base", async () => {
    const data = await captureJson(() =>
      baseViews({ json: true, vault: v.projectPath, file: "projects" }),
    );
    const views = data.views as { name: string; type: string }[];
    expect(views.length).toBe(2);
    expect(views[0].name).toBe("All Projects");
    expect(views[1].name).toBe("Active");
  });
});

describe("baseQuery", () => {
  test("queries default view", async () => {
    const data = await captureJson(() =>
      baseQuery({ json: true, vault: v.projectPath, file: "projects" }),
    );
    const rows = data.rows as Record<string, unknown>[];
    expect(rows.length).toBe(2); // Alpha + Beta in Projects folder
  });

  test("queries named view with filters", async () => {
    const data = await captureJson(() =>
      baseQuery({
        json: true,
        vault: v.projectPath,
        file: "projects",
        view: "Active",
      }),
    );
    const rows = data.rows as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Alpha");
  });

  test("outputs as paths", async () => {
    const data = await captureJson(() =>
      baseQuery({
        json: true,
        vault: v.projectPath,
        file: "projects",
        format: "paths",
      }),
    );
    const paths = data.paths as string[];
    expect(paths).toContain("Projects/alpha.md");
    expect(paths).toContain("Projects/beta.md");
  });
});
