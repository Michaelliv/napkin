import { describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { overview } from "./overview.js";

async function runOverviewJson(
  vault: string,
  opts: Partial<Parameters<typeof overview>[0]> = {},
): Promise<unknown> {
  const captured: unknown[] = [];
  const origLog = console.log;

  try {
    console.log = (...args: unknown[]) => captured.push(...args);
    await overview({
      vault,
      json: true,
      quiet: false,
      copy: false,
      ...opts,
    });
  } finally {
    console.log = origLog;
  }

  return JSON.parse(captured[0] as string);
}

describe("overview", () => {
  test("generates overview for vault with folders", async () => {
    const vault = createTempVault({
      "projects/roadmap.md":
        "---\ntags: [active]\n---\n# Roadmap\nLaunch the product in Q2",
      "projects/design.md": "# Design\nUI mockups and #wireframes",
      "notes/meeting.md": "# Meeting Notes\nDiscussed #hiring timeline",
      "readme.md": "# Welcome\nThis is the vault root",
    });

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{ path: string; notes: number; tags: string[] }>;
    };
    expect(result.overview).toBeArray();
    expect(result.overview.length).toBeGreaterThanOrEqual(3);

    const projectsFolder = result.overview.find((f) => f.path === "projects");
    expect(projectsFolder).toBeDefined();
    expect(projectsFolder?.notes).toBe(2);
    expect(projectsFolder?.tags).toContain("active");

    vault.cleanup();
  });

  test("respects depth limit", async () => {
    const vault = createTempVault({
      "a/b/c/deep.md": "# Deep note",
      "top.md": "# Top",
    });

    const result = (await runOverviewJson(vault.path, { depth: "1" })) as {
      overview: Array<{ path: string }>;
    };
    const paths = result.overview.map((f) => f.path);
    expect(paths).not.toContain("a/b/c");

    vault.cleanup();
  });

  test("skips files with malformed YAML frontmatter", async () => {
    const vault = createTempVault({
      "notes/good.md": "---\ntags: [valid]\n---\n# Good note\nHello",
      "notes/bad.md":
        "---\ntags: [#foo, #bar]\n---\n# Bad YAML\nBroken frontmatter",
      "notes/also-good.md": "# No frontmatter\nJust content",
    });

    const warnings: string[] = [];
    const captured: unknown[] = [];
    const origLog = console.log;
    const origError = console.error;

    try {
      // Warnings go to stderr so they never corrupt --json output on stdout.
      console.error = (...args: unknown[]) => {
        const msg = args.map(String).join(" ");
        if (msg.includes("⚠")) warnings.push(msg);
      };
      console.log = (...args: unknown[]) => {
        captured.push(...args);
      };
      await overview({
        vault: vault.path,
        json: true,
        quiet: false,
        copy: false,
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    const result = JSON.parse(captured[0] as string) as {
      overview: Array<{ path: string; notes: number }>;
    };
    const notesFolder = result.overview.find((f) => f.path === "notes");
    expect(notesFolder).toBeDefined();
    // bad.md is skipped for keywords/tags but still counted
    expect(notesFolder?.notes).toBe(3);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("bad.md");

    vault.cleanup();
  });

  test("warns for every file with identical malformed frontmatter", async () => {
    // Regression: gray-matter's parse cache is poisoned by a failed parse,
    // so a second file with byte-identical malformed frontmatter used to
    // silently parse as empty data — no warning, wrong tags/keywords.
    const badContent =
      "---\ntags: [#twin, #copies]\n---\n# Twin\nIdentical broken note.";
    const vault = createTempVault({
      "a/bad.md": badContent,
      "b/bad.md": badContent,
    });

    const warnings: string[] = [];
    const captured: unknown[] = [];
    const origLog = console.log;
    const origError = console.error;

    try {
      console.error = (...args: unknown[]) => {
        const msg = args.map(String).join(" ");
        if (msg.includes("⚠")) warnings.push(msg);
      };
      console.log = (...args: unknown[]) => {
        captured.push(...args);
      };
      await overview({
        vault: vault.path,
        json: true,
        quiet: false,
        copy: false,
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    expect(warnings.length).toBe(2);
    expect(warnings.join("\n")).toContain("a/bad.md");
    expect(warnings.join("\n")).toContain("b/bad.md");

    // and neither file leaks tags from the unparsed frontmatter
    const result = JSON.parse(captured[0] as string) as {
      overview: Array<{ path: string; tags: string[] }>;
    };
    for (const folder of result.overview) {
      expect(folder.tags).not.toContain("twin");
      expect(folder.tags).not.toContain("copies");
    }

    vault.cleanup();
  });

  test("empty vault", async () => {
    const vault = createTempVault({});

    const result = (await runOverviewJson(vault.path)) as {
      overview: unknown[];
    };
    expect(result.overview).toEqual([]);

    vault.cleanup();
  });

  test("excludes scaffold files and folders from overview", async () => {
    const vault = createTempVault({
      "NAPKIN.md": "# Project context\nAlways shown separately as context.",
      "Templates/Decision.md": "# {{title}}\n## Context\n## Decision",
      "decisions/_about.md": "# Decisions\nArchitecture Decision Records.",
      "decisions/postgres.md":
        "# Use PostgreSQL\nPostgreSQL stores ledger entries and merchant balances.",
    });

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{ path: string; notes: number; keywords: string[] }>;
    };
    const paths = result.overview.map((f) => f.path);
    expect(paths).toEqual(["decisions"]);

    const decisionsFolder = result.overview[0];
    expect(decisionsFolder.notes).toBe(1);
    expect(decisionsFolder.keywords).toContain("postgresql");
    expect(decisionsFolder.keywords).not.toContain("template");
    expect(decisionsFolder.keywords).not.toContain("decisions");

    vault.cleanup();
  });

  test("suppresses repeated structural headings", async () => {
    const vault = createTempVault({
      "decisions/postgres.md": `# Use PostgreSQL
## Context
Ledger writes need transactional storage.
## Decision
Use PostgreSQL for balances.
## Consequences
We operate backups.`,
      "decisions/outbox.md": `# Adopt transactional outbox
## Context
Kafka dual writes lost events.
## Decision
Write outbox events in the database transaction.
## Consequences
Relay latency increases slightly.`,
      "decisions/braintree.md": `# Deprecate Braintree
## Context
Braintree maintenance cost is high.
## Decision
Migrate merchants to Adyen.
## Consequences
Two merchants need migration plans.`,
    });

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const decisionsFolder = result.overview.find((f) => f.path === "decisions");
    expect(decisionsFolder?.keywords).toContain("postgresql");
    expect(decisionsFolder?.keywords).toContain("outbox");
    expect(decisionsFolder?.keywords).toContain("braintree");
    expect(decisionsFolder?.keywords).not.toContain("context");
    expect(decisionsFolder?.keywords).not.toContain("decision");
    expect(decisionsFolder?.keywords).not.toContain("consequences");

    vault.cleanup();
  });

  test("strips structured noise from converted documents", async () => {
    const vault = createTempVault({
      "contracts/lease.md": `# Lease agreement
DocuSign Envelope ID: AAAA1111-2222-4333-ADAB-BCF123456789
<div align="center">&nbsp;</div>
Tenant leases the third floor. Envelope ID: BBBB2222-3333-4444-EAEC-DEF987654321
Sublease requires landlord approval and a bank guarantee.`,
      "contracts/parking.md": `# Parking addendum
DocuSign Envelope ID: CCCC3333-4444-4555-FADE-CAB456789012
<div align="center">&nbsp;</div>
Reserved parking slots on level B2. Guarantee covers parking fees.`,
    });

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const folder = result.overview.find((f) => f.path === "contracts");
    expect(folder).toBeDefined();
    const tokens = folder?.keywords.flatMap((k) => k.split(" ")) ?? [];
    // GUID shrapnel ("adeb", "f25", ...) and HTML residue never become keywords
    for (const t of tokens) {
      expect(t).not.toMatch(/^[a-f0-9]{3,8}$/);
      expect(t).not.toBe("div");
      expect(t).not.toBe("align");
      expect(t).not.toBe("nbsp");
    }
    expect(tokens).toContain("guarantee");

    vault.cleanup();
  });

  test("collapses numerous homogeneous sibling folders", async () => {
    const files: Record<string, string> = {
      "procedures/deploy.md":
        "# Deploy checklist\nRun the smoke tests, then promote the build.",
    };
    // six near-identical converted-contract subfolders under imports/ —
    // heavy shared boilerplate, rotated so no sentence is in every folder
    const boilerplate = [
      "Lease agreement between landlord and tenant with signature page attached.",
      "Rent schedule and lease term apply as stated in the appendix.",
      "Bank guarantee and insurance certificate are required before occupancy.",
    ];
    for (let i = 0; i < 6; i++) {
      const shared = boilerplate.filter((_, j) => j !== i % 3).join("\n");
      files[`imports/tenant-${i}/contract.md`] =
        `# Converted document ${i}\n${shared}\nSuite ${100 + i} on floor ${i}.`;
    }
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{
        path: string;
        notes: number;
        collapsedFolders?: number;
      }>;
    };
    const paths = result.overview.map((f) => f.path);
    expect(paths).toContain("imports");
    expect(paths).not.toContain("imports/tenant-0");
    const imports = result.overview.find((f) => f.path === "imports");
    expect(imports?.collapsedFolders).toBe(6);
    expect(imports?.notes).toBe(6);
    // curated folder untouched
    expect(paths).toContain("procedures");

    // top-level folders are never collapsed into the root
    expect(paths).not.toContain("/");

    // --no-collapse restores the full listing
    const flat = (await runOverviewJson(vault.path, { collapse: false })) as {
      overview: Array<{ path: string }>;
    };
    expect(flat.overview.map((f) => f.path)).toContain("imports/tenant-0");

    vault.cleanup();
  });

  test("keeps heterogeneous sibling folders separate", async () => {
    const files: Record<string, string> = {};
    const topics = [
      ["alpha", "Kubernetes ingress routing and pod autoscaling policies."],
      ["beta", "Payroll tax withholding tables for hourly contractors."],
      ["gamma", "Sourdough fermentation schedules and hydration ratios."],
      ["delta", "Telescope collimation steps for reflector optics."],
      ["epsilon", "Beehive winterization and varroa mite treatment."],
      ["zeta", "Marathon training splits and lactate threshold pacing."],
    ] as const;
    for (const [name, body] of topics) {
      files[`areas/${name}/note.md`] = `# ${name} notes\n${body}`;
    }
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{ path: string }>;
    };
    const paths = result.overview.map((f) => f.path);
    for (const [name] of topics) {
      expect(paths).toContain(`areas/${name}`);
    }

    vault.cleanup();
  });

  test("indexes frontmatter values without exposing folder-name keywords", async () => {
    const vault = createTempVault({
      "people/asha.md":
        "---\nrole: VP Engineering\nlocation: Boston\n---\n# Asha Mehta\nOwns platform strategy.",
      "people/lukas.md":
        "---\nrole: Staff Engineer\nlocation: Berlin\n---\n# Lukas Weber\nOwns fleet dispatch.",
    });

    const result = (await runOverviewJson(vault.path)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const peopleFolder = result.overview.find((f) => f.path === "people");
    expect(peopleFolder?.keywords).toContain("engineering");
    expect(peopleFolder?.keywords).toContain("boston");
    expect(peopleFolder?.keywords).not.toContain("people");
    expect(peopleFolder?.keywords).not.toContain("person");

    vault.cleanup();
  });
});
