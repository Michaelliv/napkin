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
    expect(decisionsFolder.keywords).toContain("postgresql");
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

  // Five folders × 14 notes. "flurb" rides frontmatter values of 8 notes
  // across 4 folders; harbor's first 8 notes carry capitalized "Quixotic"
  // and lowercase "grimble" at equal concentration. Each note repeats half
  // the folder's vocabulary (rotated by parity): bursty within notes,
  // df ≈ 7 per word — under the vault-common bar. Vocabulary is capitalized
  // mid-sentence: domain words carry naming evidence, as in real vaults.
  function buildNamingEvidenceFixture(): Record<string, string> {
    const vocab: Record<string, string[]> = {
      harbor: ["berth", "mooring", "pilot", "tide", "quay", "dredge"],
      orchard: ["graft", "pruning", "cider", "blossom", "rootstock", "crate"],
      foundry: ["crucible", "ingot", "slag", "quench", "mold", "furnace"],
      lab: ["reagent", "titration", "pipette", "assay", "buffer", "vial"],
      apiary: ["brood", "nectar", "swarm", "queen", "frame", "varroa"],
    };
    const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
    const files: Record<string, string> = {};
    const topics = Object.keys(vocab);
    for (let f = 0; f < topics.length; f++) {
      for (let i = 0; i < 14; i++) {
        const fm = f < 4 && i < 2 ? "---\nsource: flurb\n---\n" : "";
        const conc =
          f === 0 && i < 8
            ? "uses Quixotic here since Quixotic parses via Quixotic\nthen grimble runs and grimble halts while grimble waits\n"
            : "";
        const body = vocab[topics[f]]
          .filter((_, k) => k % 2 === i % 2)
          .map((w) => `uses ${cap(w)} as ${w} ${w}`)
          .join(" ");
        files[`${topics[f]}/note-${i}.md`] =
          `${fm}# ${topics[f]} log ${i}\n${conc}${body}`;
      }
    }
    return files;
  }

  test("frontmatter values do not certify dispersed words as domain vocabulary", async () => {
    // "flurb" rides frontmatter values of 8 notes spread across 4 folders —
    // dispersed, never a note name — so no folder may claim it. "Quixotic"
    // is body-only but near-totally concentrated in one folder and
    // capitalized mid-sentence (the "tedious" shape: a product name that
    // never makes a filename) — that folder owns it. "grimble" has the same
    // concentration with zero naming evidence (never titled, never
    // capitalized) — prose machinery, shown nowhere. Each folder carries
    // real vocabulary (bursty, below the vault-common bar) so no row
    // starves into the relaxed filter tiers.
    const vault = createTempVault(buildNamingEvidenceFixture());

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{ path: string; keywords: string[] }>;
    };
    const words = (p: string) =>
      result.overview
        .find((r) => r.path === p)
        ?.keywords.flatMap((k) => k.split(" ")) ?? [];
    for (const r of result.overview) {
      expect(words(r.path)).not.toContain("flurb");
      expect(words(r.path)).not.toContain("grimble");
    }
    expect(words("harbor")).toContain("quixotic");

    vault.cleanup();
  });

  test("multi-topic folders decompose into name-backed topics", async () => {
    // procedures/ mixes two named subdomains (swiftcart, payroll) plus unrelated
    // singles. Topics carry content-grounded counts; a note titled
    // otherwise but substantially discussing swiftcart still belongs to it.
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[
        `procedures/Swiftcart ${["Import", "Settlement", "Menu", "Venues", "Refunds"][i]}.md`
      ] =
        `# Swiftcart ${i}\nswiftcart marketplace sync swiftcart payload courier`;
    }
    for (let i = 0; i < 4; i++) {
      files[
        `procedures/Payroll ${["Export", "Approval", "Audit", "Calendar"][i]}.md`
      ] = `# Payroll ${i}\npayroll ledger salary payroll withholding`;
    }
    files["procedures/Disguised Note.md"] =
      "# Disguised\nswiftcart courier swiftcart dispatch zones swiftcart fees";
    files["procedures/Loose End.md"] = "# Loose\nprinter toner replacement";
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{
        path: string;
        topics?: Array<{ label: string; notes: number; terms: string[] }>;
      }>;
    };
    const procedures = result.overview.find((f) => f.path === "procedures");
    const labels = procedures?.topics?.map((t) => t.label) ?? [];
    expect(labels).toContain("swiftcart");
    expect(labels).toContain("payroll");
    const swiftcart = procedures?.topics?.find((t) => t.label === "swiftcart");
    // 5 titled + 1 disguised note that substantially discusses swiftcart
    expect(swiftcart?.notes).toBe(6);

    vault.cleanup();
  });

  test("entity rosters survive strong topic vocabulary", async () => {
    // Six one-note entities with distinct 2-token names share a folder with
    // chatty notes whose repeated vocabulary dominates every salience
    // ranking. Roster terms are curated handles — the gain bar and the
    // candidate-pool cut govern derived vocabulary only.
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

  test("vault-ubiquitous names never become topics", async () => {
    // "omniword" is discussed heavily in every other folder (the
    // operator-name shape) and titles two procedure notes — under the
    // per-folder gates it would qualify (name-backed, 7 of 15 notes, below
    // the genre ceiling), but a term strong across most folders is vault
    // furniture, not a topic.
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[
        `procedures/Swiftcart ${["Import", "Settlement", "Menu", "Venues", "Refunds"][i]}.md`
      ] =
        `# Swiftcart ${i}\nomniword omniword swiftcart marketplace sync swiftcart payload`;
    }
    for (let i = 0; i < 4; i++) {
      files[
        `procedures/Payroll ${["Export", "Approval", "Audit", "Calendar"][i]}.md`
      ] = `# Payroll ${i}\npayroll ledger salary payroll withholding`;
    }
    files["procedures/Omniword Sync.md"] =
      "# Omniword Sync\nomniword omniword dispatch zones";
    files["procedures/Omniword Setup.md"] =
      "# Omniword Setup\nomniword omniword bootstrap";
    for (let i = 0; i < 4; i++) {
      files[`procedures/Note ${i}.md`] =
        `# Note ${i}\nprinter toner replacement cycle ${i}`;
    }
    for (let f = 0; f < 3; f++) {
      for (let i = 0; i < 12; i++) {
        files[`area-${f}/note-${i}.md`] =
          `# note ${i}\nomniword omniword topicless filler ${f}`;
      }
    }
    const vault = createTempVault(files);

    const result = (await runOverviewJson(vault.projectPath)) as {
      overview: Array<{
        path: string;
        topics?: Array<{ label: string }>;
      }>;
    };
    const procedures = result.overview.find((f) => f.path === "procedures");
    const labels = procedures?.topics?.map((t) => t.label) ?? [];
    expect(labels).toContain("swiftcart");
    expect(labels).not.toContain("omniword");

    vault.cleanup();
  });

  test("a dominant folder keeps its own recurring vocabulary", async () => {
    // "flimjam" recurs in every note of a folder that is ~83% of the vault
    // and titles two of them. Vault-common is measured outside the folder
    // (0 external notes contain it) and the non-domain concentration bar is
    // capped attainable — the vault's biggest domain may own its own
    // vocabulary.
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

  test("indexes frontmatter values without exposing folder-name keywords", async () => {
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
    expect(peopleFolder?.keywords).toContain("engineering");
    expect(peopleFolder?.keywords).toContain("boston");
    expect(peopleFolder?.keywords).not.toContain("people");
    expect(peopleFolder?.keywords).not.toContain("person");

    vault.cleanup();
  });
});
