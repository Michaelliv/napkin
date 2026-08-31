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

    const result = (await runOverviewJson(vault.projectPath)) as {
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

    const result = (await runOverviewJson(vault.projectPath, {
      depth: "1",
    })) as {
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
        vault: vault.projectPath,
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
        vault: vault.projectPath,
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

    const result = (await runOverviewJson(vault.projectPath)) as {
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

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{
        path: string;
        notes: number;
        keywords: string[];
        about?: string;
      }>;
    };
    const paths = result.overview.map((f) => f.path);
    expect(paths).toEqual(["decisions"]);

    const decisionsFolder = result.overview[0];
    expect(decisionsFolder.notes).toBe(1);
    // postgres.md is a 1-token roster title — the curated handle.
    expect(decisionsFolder.keywords).toContain("postgres");
    expect(decisionsFolder.keywords).not.toContain("template");
    expect(decisionsFolder.keywords).not.toContain("decisions");
    // _about.md is excluded from stats but surfaces as the row description.
    expect(decisionsFolder.about).toBe("Architecture Decision Records.");

    vault.cleanup();
  });

  test("about is absent without _about.md and skips headings", async () => {
    const vault = createTempVault({
      "plain/note.md": "# Note\nkubernetes ingress routing policies cluster",
      "described/_about.md":
        "---\ntags: [scaffold]\n---\n# Described\n\nRunnable playbooks for the on-call rotation.",
      "described/note.md": "# Note\npayroll withholding ledger invoices",
    });

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; about?: string }>;
    };
    const plain = result.overview.find((f) => f.path === "plain");
    const described = result.overview.find((f) => f.path === "described");
    expect(plain?.about).toBeUndefined();
    expect(described?.about).toBe(
      "Runnable playbooks for the on-call rotation.",
    );

    vault.cleanup();
  });

  test("about prefers the description frontmatter property verbatim", async () => {
    const vault = createTempVault({
      "ops/_about.md":
        "---\ndescription: Incident post-mortems and their prevention rules.\n---\n# Ops\n\nSome longer prose body that would otherwise be extracted.",
      "ops/note.md": "# Note\nrollback ledger replay checkpoint",
    });

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; about?: string }>;
    };
    const ops = result.overview.find((f) => f.path === "ops");
    expect(ops?.about).toBe(
      "Incident post-mortems and their prevention rules.",
    );

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

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const decisionsFolder = result.overview.find((f) => f.path === "decisions");
    expect(decisionsFolder?.keywords).toContain("postgres");
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

    const result = (await runOverviewJson(vault.projectPath)) as {
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
    // each note keeps a clean title-derived handle
    expect(folder?.keywords).toContain("lease");
    expect(folder?.keywords).toContain("parking");

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

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{
        path: string;
        notes: number;
        collapsedFolders?: number;
        contains?: string[];
      }>;
    };
    const paths = result.overview.map((f) => f.path);
    expect(paths).toContain("imports");
    expect(paths).not.toContain("imports/tenant-0");
    const imports = result.overview.find((f) => f.path === "imports");
    expect(imports?.collapsedFolders).toBe(6);
    expect(imports?.notes).toBe(6);
    // Collapsed rows list their children — folder names are entity labels.
    expect(imports?.contains).toHaveLength(6);
    expect(imports?.contains).toContain("tenant-0");
    expect(imports?.contains).toContain("tenant-5");
    // curated folder untouched
    expect(paths).toContain("procedures");

    // top-level folders are never collapsed into the root
    expect(paths).not.toContain("/");

    // --no-collapse restores the full listing
    const flat = (await runOverviewJson(vault.projectPath, {
      collapse: false,
    })) as {
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

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string }>;
    };
    const paths = result.overview.map((f) => f.path);
    for (const [name] of topics) {
      expect(paths).toContain(`areas/${name}`);
    }

    vault.cleanup();
  });

  test("shared fingerprints credit the chosen term instead of duplicating", async () => {
    // Five identical logs behind date-only titles (no title terms at
    // all): the first picks the handle, later notes are credited to it
    // when the probe proves they are reachable through it — the row
    // deduplicates and keywordNotes counts the shared coverage.
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[`procedures/2026-0${i + 1}.md`] =
        "# Log\nswiftcart marketplace sync swiftcart payload courier";
    }
    files["procedures/Payroll Export.md"] =
      "# Payroll Export\npayroll ledger salary withholding export";
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{
        path: string;
        keywords: string[];
        keywordNotes: number[];
      }>;
    };
    const procedures = result.overview.find((f) => f.path === "procedures");
    expect(procedures).toBeDefined();
    const kw = procedures?.keywords ?? [];
    // fewer handles than notes: the swiftcart cluster deduplicated
    expect(kw.length).toBeLessThan(6);
    const swiftcartIdx = kw.findIndex((k) => k.includes("swiftcart"));
    expect(swiftcartIdx).toBeGreaterThanOrEqual(0);
    // the shared handle carries multi-note credit
    expect(procedures?.keywordNotes[swiftcartIdx]).toBeGreaterThanOrEqual(2);
    // the singleton domain is still present
    expect(kw.some((k) => k.includes("payroll"))).toBe(true);

    vault.cleanup();
  });

  test("roster-titled notes are covered by their title, not body episodes", async () => {
    // A person note's body is episode, not identity: the row lists the
    // person, never the episode vocabulary.
    const vault = createTempVault({
      "people/Dana Arbel.md":
        "# Dana Arbel\ntruck temperature relay saved shipment relay saved",
      "people/Noa Peretz.md":
        "# Noa Peretz\ninvoice dispute escalation invoice dispute",
      "notes/context.md":
        "# Context\nkubernetes ingress routing policies cluster",
    });

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const people = result.overview.find((f) => f.path === "people");
    expect(people?.keywords).toContain("dana arbel");
    expect(people?.keywords).toContain("noa peretz");
    expect(people?.keywords).not.toContain("truck temperature");
    expect(people?.keywords).not.toContain("invoice dispute");

    vault.cleanup();
  });

  test("digit-collapsed titles are fingerprinted from content", async () => {
    // "vex-0.14" tokenizes to just "vex" — not a roster identity. Each
    // release note must surface its own content handle instead of all
    // collapsing behind one shared word.
    const vault = createTempVault({
      "releases/vex-0.14.md":
        "# vex 0.14\ninfiniti rollout actions cloud plugin infiniti",
      "releases/vex-0.15.md":
        "# vex 0.15\npublishing pages drafts publishing cut notes",
      "notes/context.md":
        "# Context\nkubernetes ingress routing policies cluster",
    });

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const releases = result.overview.find((f) => f.path === "releases");
    const kw = releases?.keywords ?? [];
    expect(kw.some((k) => k.includes("infiniti"))).toBe(true);
    expect(kw.some((k) => k.includes("publishing"))).toBe(true);

    vault.cleanup();
  });

  test("KB-common vocabulary is subtracted, measured outside the folder", async () => {
    // "acme" saturates every note in both folders — furniture, banned.
    // Folder-local ubiquity is ownership, not furniture: distinct
    // vocabulary in each folder survives.
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) {
      files[`harbor/log-${i}.md`] =
        `# harbor log ${i}\nacme berth mooring tide acme dredge quay ${i}`;
      files[`orchard/log-${i}.md`] =
        `# orchard log ${i}\nacme graft pruning cider acme rootstock crate ${i}`;
    }
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    for (const row of result.overview) {
      const tokens = row.keywords.flatMap((k) => k.split(" "));
      expect(tokens).not.toContain("acme");
    }
    const harbor = result.overview.find((f) => f.path === "harbor");
    const harborTokens = harbor?.keywords.flatMap((k) => k.split(" ")) ?? [];
    expect(harborTokens.length).toBeGreaterThan(0);

    vault.cleanup();
  });

  test("entity rosters survive strong topic vocabulary", async () => {
    // Six one-note entities with distinct 2-token names share a folder
    // with chatty notes whose repeated vocabulary dominates the term
    // statistics. Roster terms are curated handles — every entity is
    // listed regardless of what the chatty notes fingerprint.
    const files: Record<string, string> = {};
    const names = [
      "zorblatt corp",
      "quenda holdings",
      "virell group",
      "maxton labs",
      "ostrafin bank",
      "pelagio fund",
    ];
    for (const name of names) {
      const title = name.replace(/\b\w/g, (c) => c.toUpperCase());
      files[`accounts/${title}.md`] = `# ${title}\nA client account.`;
    }
    const vocab = [
      "pipeline",
      "renewal",
      "forecast",
      "scoring",
      "quota",
      "attainment",
      "coverage",
      "velocity",
    ];
    for (let i = 0; i < 12; i++) {
      const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
      const body = vocab
        .map((w) => `uses ${cap(w)} as ${w} ${w} ${w} ${w} ${w}`)
        .join(" ");
      files[`accounts/briefing-note-${i}.md`] = `# briefing note ${i}\n${body}`;
    }
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const accounts = result.overview.find((f) => f.path === "accounts");
    for (const name of names) {
      expect(accounts?.keywords).toContain(name);
    }

    vault.cleanup();
  });

  test("a dominant folder keeps its own recurring vocabulary", async () => {
    // "flimjam" recurs in every note of a folder that is ~83% of the vault
    // and titles two of them. KB-common is measured outside the folder
    // (0 external notes contain it) — the vault's biggest domain owns its
    // own vocabulary.
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const name = i < 2 ? `flimjam log ${i}` : `event ${i}`;
      files[`dominant/${name}.md`] =
        `# event ${i}\nflimjam flimjam flimjam relay check ${i}`;
    }
    for (let i = 0; i < 4; i++) {
      files[`minor/note-${i}.md`] =
        `# note ${i}\npayroll payroll payroll ledger entry ${i}`;
    }
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const dominant = result.overview.find((f) => f.path === "dominant");
    expect(dominant?.keywords).toContain("flimjam");

    vault.cleanup();
  });

  test("entity folders list their roster without folder-name keywords", async () => {
    const vault = createTempVault({
      "people/asha.md":
        "---\nrole: VP Engineering\nlocation: Boston\n---\n# Asha Mehta\nOwns platform strategy.",
      "people/lukas.md":
        "---\nrole: Staff Engineer\nlocation: Berlin\n---\n# Lukas Weber\nOwns fleet dispatch.",
    });

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const peopleFolder = result.overview.find((f) => f.path === "people");
    expect(peopleFolder?.keywords).toContain("asha");
    expect(peopleFolder?.keywords).toContain("lukas");
    expect(peopleFolder?.keywords).not.toContain("people");
    expect(peopleFolder?.keywords).not.toContain("person");

    vault.cleanup();
  });
});
