import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildDatabase,
  filterToSQL,
  parseBaseFile,
  queryBase,
} from "./bases.js";
import {
  createFormulaEngine,
  evaluateFormulas,
  obsidianToJexl,
} from "./formula.js";
import { createTempVault } from "./test-helpers.js";

let v: ReturnType<typeof createTempVault>;

beforeEach(() => {
  v = createTempVault({
    "Projects/alpha.md":
      "---\ntitle: Alpha\nstatus: active\npriority: 1\ntags:\n  - project\n---\n# Alpha\nSome content",
    "Projects/beta.md":
      "---\ntitle: Beta\nstatus: done\npriority: 3\ntags:\n  - project\n  - archive\n---\n# Beta\nDone stuff",
    "Projects/gamma.md":
      "---\ntitle: Gamma\nstatus: active\npriority: 2\n---\n# Gamma\nMore content with [[Alpha]]",
    "Notes/random.md": "---\ntitle: Random\n---\n# Random\nJust a #note",
    "Notes/daily.md": "# Daily\n- [ ] Task 1\n- [x] Task 2",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("buildDatabase", () => {
  test("creates database with all files", async () => {
    const db = await buildDatabase(v.contentPath);
    const result = db.exec("SELECT COUNT(*) FROM files");
    expect(result[0].values[0][0]).toBe(5);
    db.close();
  });

  test("indexes frontmatter properties as columns", async () => {
    const db = await buildDatabase(v.contentPath);
    const result = db.exec(
      "SELECT prop_title, prop_status FROM files WHERE prop_title = 'Alpha'",
    );
    expect(result[0].values[0][0]).toBe("Alpha");
    expect(result[0].values[0][1]).toBe("active");
    db.close();
  });

  test("stores tags as JSON array", async () => {
    const db = await buildDatabase(v.contentPath);
    const result = db.exec("SELECT tags FROM files WHERE prop_title = 'Alpha'");
    const tags = JSON.parse(result[0].values[0][0] as string);
    expect(tags).toContain("project");
    db.close();
  });

  test("stores file metadata", async () => {
    const db = await buildDatabase(v.contentPath);
    const result = db.exec(
      "SELECT name, folder, ext FROM files WHERE prop_title = 'Alpha'",
    );
    expect(result[0].values[0][0]).toBe("alpha.md");
    expect(result[0].values[0][1]).toBe("Projects");
    expect(result[0].values[0][2]).toBe("md");
    db.close();
  });
});

describe("filterToSQL", () => {
  test("translates simple comparison", () => {
    const sql = filterToSQL('status != "done"');
    expect(sql).toContain("prop_status");
    expect(sql).toContain("!=");
    expect(sql).toContain("done");
  });

  test("translates file.hasTag", () => {
    const sql = filterToSQL('file.hasTag("project")');
    expect(sql).toContain("tags LIKE");
    expect(sql).toContain("project");
  });

  test("translates file.inFolder", () => {
    const sql = filterToSQL('file.inFolder("Projects")');
    expect(sql).toContain("folder");
    expect(sql).toContain("Projects");
  });

  test("translates and/or", () => {
    const sql = filterToSQL({
      and: ['status == "active"', 'file.hasTag("project")'],
    });
    expect(sql).toContain("AND");
  });

  test("translates or", () => {
    const sql = filterToSQL({ or: ['status == "active"', 'status == "done"'] });
    expect(sql).toContain("OR");
  });

  test("translates not", () => {
    const sql = filterToSQL({ not: ['status == "done"'] });
    expect(sql).toContain("NOT");
  });
});

describe("file.backlinks, file.embeds, file.properties", () => {
  test("backlinks are computed", async () => {
    const db = await buildDatabase(v.contentPath);
    // gamma.md has [[Alpha]] link, so alpha should have a backlink from gamma
    const result = db.exec(
      "SELECT backlinks FROM files WHERE basename = 'alpha'",
    );
    const backlinks = JSON.parse(result[0].values[0][0] as string);
    expect(backlinks).toContain("gamma");
    db.close();
  });

  test("embeds column exists", async () => {
    const db = await buildDatabase(v.contentPath);
    const result = db.exec("SELECT embeds FROM files LIMIT 1");
    expect(result[0].columns).toContain("embeds");
    db.close();
  });

  test("file_properties column stores frontmatter", async () => {
    const db = await buildDatabase(v.contentPath);
    const result = db.exec(
      "SELECT file_properties FROM files WHERE basename = 'alpha'",
    );
    const props = JSON.parse(result[0].values[0][0] as string);
    expect(props.title).toBe("Alpha");
    expect(props.status).toBe("active");
    db.close();
  });
});

describe("regex filters", () => {
  test("regex pattern translates to REGEXP", () => {
    const sql = filterToSQL("/^\\d{4}-\\d{2}-\\d{2}$/.matches(file.basename)");
    expect(sql).toContain("REGEXP");
    expect(sql).toContain("basename");
  });

  test("regex filter works in query", async () => {
    const db = await buildDatabase(v.contentPath);
    // Match files with lowercase alpha-only basenames
    const config = parseBaseFile(
      "filters:\n  '/^[a-z]+$/.matches(file.basename)'\nviews:\n  - type: table",
    );
    const result = await queryBase(db, config);
    // alpha, beta, gamma, random, daily — all match
    expect(result.rows.length).toBe(5);
    db.close();
  });
});

describe("list method filters", () => {
  test("list property contains works via JSON LIKE", async () => {
    const db = await buildDatabase(v.contentPath);
    // tags are stored as JSON, contains works on the JSON string
    const config = parseBaseFile(
      'filters:\n  file.hasTag("project")\nviews:\n  - type: table',
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(2); // Alpha and Beta
    db.close();
  });
});

describe("string method filters", () => {
  test("contains translates to LIKE", () => {
    const sql = filterToSQL('title.contains("lph")');
    expect(sql).toContain("LIKE '%lph%'");
  });

  test("startsWith translates to LIKE prefix", () => {
    const sql = filterToSQL('title.startsWith("Al")');
    expect(sql).toContain("LIKE 'Al%'");
  });

  test("endsWith translates to LIKE suffix", () => {
    const sql = filterToSQL('title.endsWith("ha")');
    expect(sql).toContain("LIKE '%ha'");
  });

  test("isEmpty translates to IS NULL OR empty", () => {
    const sql = filterToSQL("status.isEmpty()");
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("= ''");
  });

  test("contains works in query", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile(
      "filters:\n  'title.contains(\"lph\")'\nviews:\n  - type: table",
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(1); // Alpha
    db.close();
  });
});

describe("inline boolean operators", () => {
  test("&& translates to AND", () => {
    const sql = filterToSQL('status == "active" && priority >= 3');
    expect(sql).toContain("AND");
    expect(sql).toContain("prop_status");
    expect(sql).toContain("prop_priority");
  });

  test("|| translates to OR", () => {
    const sql = filterToSQL('status == "active" || status == "done"');
    expect(sql).toContain("OR");
  });

  test("! prefix translates to NOT", () => {
    const sql = filterToSQL('!file.hasTag("archived")');
    expect(sql).toContain("NOT");
    expect(sql).toContain("archived");
  });

  test("&& works in actual query", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile(
      "filters:\n  'status == \"active\" && priority >= 2'\nviews:\n  - type: table",
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(1); // Only Gamma: active + priority 2
    db.close();
  });
});

describe("date functions in filters", () => {
  test("now() resolves to a timestamp", () => {
    const sql = filterToSQL('file.mtime > now() - "7d"');
    // Should contain a numeric timestamp, not the literal "now()"
    expect(sql).not.toContain("now()");
    expect(sql).toContain("mtime >");
  });

  test("today() resolves to midnight timestamp", () => {
    const sql = filterToSQL("file.ctime > today()");
    expect(sql).not.toContain("today()");
    expect(sql).toContain("ctime >");
  });

  test("date() resolves to timestamp", () => {
    const sql = filterToSQL('file.ctime > date("2024-01-01")');
    const expected = new Date("2024-01-01").getTime();
    expect(sql).toContain(String(expected));
  });

  test("date arithmetic works in queries", async () => {
    const db = await buildDatabase(v.contentPath);
    // All files were just created, so mtime > now() - "1d" should match all
    const config = parseBaseFile(
      "filters:\n  'file.mtime > now() - \"365d\"'\nviews:\n  - type: table",
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(5);
    db.close();
  });
});

describe("formula engine", () => {
  test("simple arithmetic formula", async () => {
    const engine = createFormulaEngine();
    const result = await engine.eval(obsidianToJexl("price * quantity"), {
      price: 10,
      quantity: 3,
    });
    expect(result).toBe(30);
  });

  test("if() formula", async () => {
    const engine = createFormulaEngine();
    const result = await engine.eval(obsidianToJexl('if(done, "✅", "⏳")'), {
      done: true,
    });
    expect(result).toBe("✅");
    const result2 = await engine.eval(obsidianToJexl('if(done, "✅", "⏳")'), {
      done: false,
    });
    expect(result2).toBe("⏳");
  });

  test("toFixed transform", async () => {
    const engine = createFormulaEngine();
    const result = await engine.eval(obsidianToJexl("price.toFixed(2)"), {
      price: 4.5,
    });
    expect(result).toBe("4.50");
  });

  test("string concatenation with function", async () => {
    const engine = createFormulaEngine();
    const result = await engine.eval(
      obsidianToJexl('if(price, price.toFixed(2) + " dollars")'),
      { price: 4.5 },
    );
    expect(result).toBe("4.50 dollars");
  });

  test("date format", async () => {
    const engine = createFormulaEngine();
    const ts = new Date("2024-06-15T10:30:00").getTime();
    const result = await engine.eval(
      obsidianToJexl('file.ctime.format("YYYY-MM-DD")'),
      { file: { ctime: ts } },
    );
    expect(result).toBe("2024-06-15");
  });

  test("now() and today()", async () => {
    const engine = createFormulaEngine();
    const n = await engine.eval("now()");
    expect(typeof n).toBe("number");
    expect(Math.abs((n as number) - Date.now())).toBeLessThan(1000);
  });

  test("formula referencing another formula", async () => {
    const formulas = {
      base_price: "price * 2",
      total: "formula.base_price + 10",
    };
    const columns = ["price"];
    const row = [5];
    const results = await evaluateFormulas(
      createFormulaEngine(),
      formulas,
      columns,
      row,
    );
    expect(results.base_price).toBe(10);
    expect(results.total).toBe(20);
  });

  test("obsidianToJexl transforms dot methods to pipes", () => {
    expect(obsidianToJexl("price.toFixed(2)")).toBe("price|toFixed(2)");
    expect(obsidianToJexl("name.lower()")).toBe("name|lower()");
    expect(obsidianToJexl("file.name")).toBe("file.name"); // property access, not transform
    expect(obsidianToJexl('if(done, "yes", "no")')).toBe(
      '_if(done, "yes", "no")',
    );
  });

  test("duration fields", async () => {
    const engine = createFormulaEngine();
    const oneDay = 86400000;
    const result = await engine.eval(obsidianToJexl("diff.days"), {
      diff: oneDay,
    });
    expect(result).toBe(1);
  });
});

describe("formulas in queryBase", () => {
  test("computes formula columns", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
formulas:
  doubled: "priority * 2"
filters:
  and:
    - file.hasProperty("priority")
views:
  - type: table
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config);
    const formulaIdx = result.columns.indexOf("formula.doubled");
    expect(formulaIdx).toBeGreaterThan(-1);
    // Alpha has priority 1, so doubled = 2
    for (const row of result.rows) {
      const prioIdx = result.columns.indexOf("priority");
      const prio = Number(row[prioIdx]);
      expect(row[formulaIdx]).toBe(prio * 2);
    }
    db.close();
  });
});

describe("summaries", () => {
  test("computes Sum summary", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
filters:
  file.hasProperty("priority")
views:
  - type: table
    summaries:
      priority: Sum
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config);
    expect(result.summaries).toBeDefined();
    expect(result.summaries?.priority).toBe(6); // 1 + 3 + 2
    db.close();
  });

  test("computes Average summary", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
filters:
  file.hasProperty("priority")
views:
  - type: table
    summaries:
      priority: Average
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config);
    expect(result.summaries?.priority).toBe(2); // (1+3+2)/3
    db.close();
  });

  test("computes Unique summary", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
filters:
  file.hasProperty("status")
views:
  - type: table
    summaries:
      status: Unique
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config);
    expect(result.summaries?.status).toBe(2); // "active" and "done"
    db.close();
  });
});

describe("groupBy", () => {
  test("groups by property", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
filters:
  file.hasProperty("status")
views:
  - type: table
    groupBy:
      property: status
      direction: ASC
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config);
    expect(result.groups).toBeDefined();
    expect(result.groups?.length).toBe(2); // active, done
    const keys = result.groups?.map((g) => g.key);
    expect(keys).toContain("active");
    expect(keys).toContain("done");
    db.close();
  });
});

describe("displayNames", () => {
  test("maps display names", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
properties:
  status:
    displayName: "Status"
  priority:
    displayName: "Priority Level"
views:
  - type: table
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config);
    expect(result.displayNames).toBeDefined();
    expect(result.displayNames?.status).toBe("Status");
    expect(result.displayNames?.priority).toBe("Priority Level");
    db.close();
  });
});

describe("this keyword", () => {
  test("this.file.folder resolves in filter", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile(
      "filters:\n  'file.inFolder(this.file.folder)'\nviews:\n  - type: table",
    );
    const thisFile = {
      name: "projects.base",
      path: "Projects/projects.base",
      folder: "Projects",
    };
    const result = await queryBase(db, config, undefined, thisFile);
    // Should only return files in Projects folder
    expect(result.rows.length).toBe(3);
    db.close();
  });

  test("this.file.name resolves in filter", () => {
    const thisFile = { name: "test.base", path: "test.base", folder: "." };
    const sql = filterToSQL("file.hasLink(this.file.name)", thisFile);
    expect(sql).toContain("test.base");
    expect(sql).not.toContain("this.");
  });
});

describe("comprehensive integration", () => {
  test("full bases feature set", async () => {
    // Create vault with richer data
    const rich = createTempVault({
      "Projects/web-app.md":
        "---\ntitle: Web App\nstatus: active\npriority: 1\ntags:\n  - project\n  - web\nbudget: 5000\n---\n# Web App\nMain project with [[API Design]]",
      "Projects/api-design.md":
        "---\ntitle: API Design\nstatus: active\npriority: 2\ntags:\n  - project\n  - api\nbudget: 3000\n---\n# API Design\nAPI docs",
      "Projects/old-site.md":
        "---\ntitle: Old Site\nstatus: done\npriority: 3\ntags:\n  - project\n  - web\n  - archived\nbudget: 1000\n---\n# Old Site\nDone and dusted",
      "Notes/meeting.md":
        "---\ntitle: Meeting Notes\nstatus: active\ntags:\n  - meeting\n---\n# Meeting\nDiscussed [[Web App]] and [[API Design]]",
    });

    const db = await buildDatabase(rich.contentPath);
    const yaml = `
filters:
  and:
    - file.inFolder("Projects")
    - 'file.ext == "md"'
formulas:
  budget_label: 'if(budget, budget.toFixed(0) + " USD", "N/A")'
  priority_icon: 'if(priority == 1, "🔴", if(priority == 2, "🟡", "🟢"))'
properties:
  status:
    displayName: "Status"
  formula.budget_label:
    displayName: "Budget"
  formula.priority_icon:
    displayName: "Priority"
views:
  - type: table
    name: "All Projects"
    order:
      - file.name
      - status
    summaries:
      budget: Sum
  - type: table
    name: "Active Only"
    filters:
      'status == "active"'
    groupBy:
      property: status
      direction: ASC
`;
    const config = parseBaseFile(yaml);

    // Query "All Projects" view
    const all = await queryBase(db, config, "All Projects");
    expect(all.rows.length).toBe(3);
    expect(all.summaries).toBeDefined();
    expect(all.summaries?.budget).toBe(9000); // 5000 + 3000 + 1000
    expect(all.displayNames?.status).toBe("Status");

    // Check formula columns exist
    const budgetLabelIdx = all.columns.indexOf("formula.budget_label");
    expect(budgetLabelIdx).toBeGreaterThan(-1);
    // Web App has budget 5000
    const webAppRow = all.rows.find((r) => {
      const nameIdx = all.columns.indexOf("name");
      return r[nameIdx] === "web-app.md";
    });
    expect(webAppRow?.[budgetLabelIdx]).toBe("5000 USD");

    const priorityIdx = all.columns.indexOf("formula.priority_icon");
    expect(webAppRow?.[priorityIdx]).toBe("🔴");

    // Query "Active Only" view
    const active = await queryBase(db, config, "Active Only");
    expect(active.rows.length).toBe(2); // web-app + api-design
    expect(active.groups).toBeDefined();
    expect(active.groups?.length).toBe(1); // All "active"
    expect(active.groups?.[0].key).toBe("active");

    db.close();
    rich.cleanup();
  });
});

describe("queryBase", () => {
  test("queries with file.inFolder filter", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile(
      'filters:\n  file.inFolder("Projects")\nviews:\n  - type: table\n    name: Projects',
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(3);
    db.close();
  });

  test("queries with property filter", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile(
      'filters:\n  and:\n    - \'status == "active"\'\n    - file.inFolder("Projects")\nviews:\n  - type: table',
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(2); // Alpha and Gamma
    db.close();
  });

  test("queries with hasTag filter", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile(
      'filters:\n  file.hasTag("project")\nviews:\n  - type: table',
    );
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(2); // Alpha and Beta have 'project' tag
    db.close();
  });

  test("respects view limit", async () => {
    const db = await buildDatabase(v.contentPath);
    const config = parseBaseFile("views:\n  - type: table\n    limit: 2");
    const result = await queryBase(db, config);
    expect(result.rows.length).toBe(2);
    db.close();
  });

  test("selects view by name", async () => {
    const db = await buildDatabase(v.contentPath);
    const yaml = `
views:
  - type: table
    name: All
  - type: table
    name: Active
    filters:
      'status == "active"'
`;
    const config = parseBaseFile(yaml);
    const result = await queryBase(db, config, "Active");
    // Only active status files
    const statusIdx = result.columns.indexOf("status");
    for (const row of result.rows) {
      expect(row[statusIdx]).toBe("active");
    }
    db.close();
  });
});
