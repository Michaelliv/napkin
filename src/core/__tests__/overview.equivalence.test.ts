import { describe, expect, test } from "bun:test";
import matter from "gray-matter";
import { createTempVault } from "../../utils/test-helpers.js";
import { _stripNoise, _termCounts, getOverview } from "../overview.js";
import {
  originalGetOverview,
  originalStripNoise,
  originalTerms,
} from "./overview-original.js";

/**
 * Differential test suite: the optimized overview pipeline vs a verbatim
 * copy of the pre-optimization implementation (overview-original.ts).
 *
 * The refactor made three equivalence claims, each verified here:
 *  1. Guarded stripNoise ≡ unguarded stripNoise (guards are necessary
 *     conditions of their patterns; HEX_HASH may skip digitless text because
 *     HEXLETTER_RUN already removed pure-letter runs).
 *  2. termCounts(text) ≡ occurrence-wise accumulation of terms(text),
 *     including Map INSERTION ORDER (keyword tie-breaking is a stable sort
 *     over Map iteration order, so order is behavior, not a detail).
 *  3. The full pipeline produces byte-identical JSON for arbitrary vaults
 *     and options.
 *
 * Cache isolation: gray-matter memoizes by content string and caches the
 * file object BEFORE parsing, so the first parse of malformed frontmatter
 * throws while a later parse of the identical string silently returns empty
 * data. Both implementations issue identical matter() call sequences, so
 * they are equivalent given equal cache state — the harness clears the cache
 * before every pipeline run to compare them from the same starting state.
 */

function isolated<T>(fn: () => T): T {
  matter.clearCache();
  return fn();
}

// ─── deterministic PRNG ─────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function int(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

// ─── adversarial fragment pool ──────────────────────────────────────
// Every fragment targets a specific stripNoise pattern, a guard boundary,
// a tokenizer edge, or keyword-pipeline behavior.

const FRAGMENTS: readonly string[] = [
  // hex-letter runs at the 6/7/8 length boundaries, case variants
  "abcdef",
  "abcdefa",
  "deadbeef",
  "DEADBEEF",
  "deadbeefcafe",
  "xabcdefgh",
  "gabcdefabx",
  // hex hashes with digits (8+ boundary)
  "e5f6a7b8",
  "a1b2c3d",
  "cafe1234babe0000",
  "0123456789abcdef",
  // digit blobs (6+ mixed alnum) and short non-matches
  "abc123def",
  "ab12x",
  "x1y2z3",
  "INV20240915X",
  "b2",
  // dashed hex, including non-hex dashes and list dashes
  "ab-cd",
  "AB-CD-EF",
  "a1-b2-c3",
  "12-34-56",
  "well-known",
  "- list item",
  "AAAA1111-2222-4333-ADAB-BCF123456789",
  // emails and near-emails
  "user@example.com",
  "leasing@sub.example.co.uk",
  "not @ email",
  "@handle",
  "a@b.co",
  // URLs, case variants (URL_RE is case-sensitive)
  "https://example.com/portal?id=99",
  "http://x.y/z#frag",
  "HTTP://UPPER.EXAMPLE.COM",
  "httpish prose word",
  // inline code and fences, closed and unclosed
  "`inline code`",
  "` unclosed backtick",
  "```\nconst rent = base * 1.05;\n```",
  "``` unclosed fence\ncode-ish 42",
  // HTML tags and entities, real and fake
  '<div align="center">',
  "</p>",
  "< notatag",
  "<3 hearts",
  "&nbsp;",
  "&amp;",
  "&#123;",
  "& plain ampersand",
  "&notarealentity",
  // stopwords, short tokens, unicode
  "the and with very just about",
  "an ox is up",
  "naïve café über résumé 東京",
  // ordinary prose (keyword candidates, bigram material)
  "kubernetes ingress routing policies",
  "payroll tax withholding tables",
  "telescope collimation reflector optics",
  "transactional outbox relay latency",
  "bank guarantee insurance certificate",
  "lease agreement landlord tenant",
  "Suite 100 on floor 3",
  // markdown structure
  "## Context",
  "## Decision ",
  "# Top Heading",
  "[[Some Note|alias]]",
  "2024-03-01 kickoff meeting",
];

const SEPARATORS: readonly string[] = [" ", "\n", ", ", ".\n\n", " — "];

function randomText(rand: () => number, maxFragments = 30): string {
  const n = int(rand, 1, maxFragments);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(pick(rand, FRAGMENTS));
    if (i < n - 1) parts.push(pick(rand, SEPARATORS));
  }
  return parts.join("");
}

// ─── layer 1: stripNoise guards ─────────────────────────────────────

describe("stripNoise ≡ original", () => {
  test("fixed adversarial cases (one per guard boundary)", () => {
    const cases = [
      "", // empty
      "plain prose with no noise at all",
      "HTTP://UPPER.COM has http only lowercase-guarded", // URL guard vs case
      "Http://Mixed.Com httpx", // "http" present, pattern can't match
      "at sign only: a @ b", // "@" present, email can't match
      "deadbeef", // pure-letter hex, no digit: HEX_HASH must still be stripped via HEXLETTER_RUN
      "deadbeefX deadbeef1", // adjacent digit/no-digit hex
      "xabcdefgh embedded run without word boundary",
      "ab-cd but no digits anywhere", // DASHED_HEX without digits
      "-- --- - dashes only",
      "`` empty inline", // backtick present, empty inline can't match
      "``` only one fence",
      "&& & &; &#; entity near-misses",
      "<> < > angle near-misses",
      "١٢٣ unicode digits ٤٥٦", // \d is ASCII-only: hasDigit guard must not differ
      "𝟏𝟐𝟑 mathematical digits",
    ];
    for (const c of cases) {
      expect(_stripNoise(c)).toBe(originalStripNoise(c));
    }
  });

  test("20,000 fuzzed strings", () => {
    const rand = mulberry32(0x0135e);
    for (let i = 0; i < 20_000; i++) {
      const s = randomText(rand);
      const got = _stripNoise(s);
      const want = originalStripNoise(s);
      if (got !== want) {
        // fail with the offending input visible
        expect({ input: s, got }).toEqual({ input: s, got: want });
      }
      expect(got).toBe(want);
    }
  });
});

// ─── layer 2: termCounts vs occurrence-wise terms() ─────────────────

/** The original accumulation: +1 per occurrence, in occurrence order. */
function originalCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of originalTerms(text)) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

describe("termCounts ≡ original occurrence accumulation", () => {
  test("10,000 fuzzed strings: values AND insertion order", () => {
    const rand = mulberry32(0x7e12);
    for (let i = 0; i < 10_000; i++) {
      const s = randomText(rand);
      const got = _termCounts(s);
      const want = originalCounts(s);
      // insertion order is behavior: keyword tie-breaks depend on it
      expect([...got.keys()]).toEqual([...want.keys()]);
      expect([...got.values()]).toEqual([...want.values()]);
    }
  });

  test("repeated terms keep first-occurrence position", () => {
    const got = _termCounts("alpha beta alpha gamma beta alpha");
    expect([...got.entries()]).toEqual([
      ["alpha", 3],
      ["beta", 2],
      ["gamma", 1],
      ["alpha beta", 1],
      ["beta alpha", 2],
      ["alpha gamma", 1],
      ["gamma beta", 1],
    ]);
  });
});

// ─── layer 3: weighted multi-source accumulation order ──────────────

describe("weighted accumulation ≡ original buildTF", () => {
  test("2,000 fuzzed source sequences: merged map order and values", () => {
    const rand = mulberry32(0xacc);
    for (let i = 0; i < 2_000; i++) {
      const nSources = int(rand, 1, 6);
      const sources: { text: string; weight: number }[] = [];
      for (let j = 0; j < nSources; j++) {
        sources.push({
          text: randomText(rand, 8),
          weight: pick(rand, [1, 2, 3]),
        });
      }
      // original: occurrence-wise, source by source
      const want = new Map<string, number>();
      for (const { text, weight } of sources) {
        for (const t of originalTerms(text)) {
          want.set(t, (want.get(t) || 0) + weight);
        }
      }
      // new: count once per source, merge unique entries
      const got = new Map<string, number>();
      for (const { text, weight } of sources) {
        for (const [t, c] of _termCounts(text)) {
          got.set(t, (got.get(t) || 0) + c * weight);
        }
      }
      expect([...got.keys()]).toEqual([...want.keys()]);
      expect([...got.values()]).toEqual([...want.values()]);
    }
  });
});

// ─── layer 4: full pipeline on randomized vaults ────────────────────

const HEADING_POOL: readonly string[] = [
  "Context",
  "Decision",
  "Consequences",
  "Overview",
  "Notes ", // trailing space: exercises trimmed heading-cache key
  "Notes",
  "Kubernetes Setup",
  "Bank Guarantee",
];

const FOLDER_POOL: readonly string[] = [
  "decisions",
  "notes",
  "people",
  "contracts",
  "areas/alpha",
  "areas/beta",
  "projects/web/frontend",
  "deep/one/two/three",
];

function randomFrontmatter(rand: () => number): string {
  if (rand() < 0.1) return "---\ntags: [#bad, #yaml]\n---\n"; // malformed
  const lines = ["---"];
  if (rand() < 0.7) lines.push(`title: Title ${int(rand, 1, 5)} guarantee`);
  if (rand() < 0.5) lines.push("tags: [adr, database]");
  if (rand() < 0.4) lines.push("status: accepted");
  if (rand() < 0.4) lines.push("date: 2024-03-01");
  if (rand() < 0.4) lines.push('related: "[[outbox]]"');
  if (rand() < 0.4) lines.push(`role: Staff Engineer ${pick(rand, FRAGMENTS)}`);
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

function randomNote(rand: () => number): string {
  let content = rand() < 0.7 ? randomFrontmatter(rand) : "";
  const nHeadings = int(rand, 0, 3);
  for (let h = 0; h < nHeadings; h++) {
    content += `${"#".repeat(int(rand, 1, 3))} ${pick(rand, HEADING_POOL)}\n`;
    content += `${randomText(rand, 10)}\n`;
  }
  content += randomText(rand, 15);
  return content;
}

function randomVault(rand: () => number): Record<string, string> {
  const files: Record<string, string> = {};
  if (rand() < 0.5) files["NAPKIN.md"] = "# Context\nGolden fuzz vault.";
  if (rand() < 0.5) files["Templates/Decision.md"] = "# {{title}}\n## Context";
  if (rand() < 0.3) files["welcome.md"] = randomNote(rand);

  const nFiles = int(rand, 3, 20);
  for (let i = 0; i < nFiles; i++) {
    const folder = pick(rand, FOLDER_POOL);
    files[`${folder}/note-${i}.md`] = randomNote(rand);
    if (rand() < 0.15) files[`${folder}/_about.md`] = "# About\nScaffold.";
  }

  // homogeneous sibling fan (collapse candidate) — shared boilerplate
  if (rand() < 0.6) {
    const fanSize = int(rand, 4, 8); // straddles COLLAPSE_MIN_CHILDREN=5
    const shared =
      "Lease agreement between landlord and tenant.\n" +
      "Bank guarantee and insurance certificate required.";
    for (let i = 0; i < fanSize; i++) {
      files[`imports/tenant-${i}/contract.md`] =
        `# Converted document ${i}\n${shared}\nSuite ${100 + i}.`;
    }
  }

  // heterogeneous sibling fan (must NOT collapse)
  if (rand() < 0.4) {
    const topics = [
      "Kubernetes ingress routing and pod autoscaling.",
      "Payroll tax withholding for hourly contractors.",
      "Sourdough fermentation schedules and hydration.",
      "Telescope collimation for reflector optics.",
      "Beehive winterization and varroa treatment.",
      "Marathon splits and lactate threshold pacing.",
    ];
    topics.forEach((body, i) => {
      files[`mixed/topic-${i}/note.md`] = `# Topic ${i}\n${body}`;
    });
  }

  return files;
}

describe("getOverview ≡ original on randomized vaults", () => {
  test("60 fuzzed vaults × random options, byte-identical JSON", () => {
    const rand = mulberry32(0x0a017);
    for (let i = 0; i < 60; i++) {
      const vault = createTempVault(randomVault(rand));
      try {
        const opts = {
          depth: int(rand, 1, 4),
          keywords: int(rand, 3, 10),
          collapse: rand() < 0.5,
        };
        const got = isolated(() =>
          getOverview(vault.vaultPath, vault.vaultPath, opts),
        );
        const want = isolated(() =>
          originalGetOverview(vault.vaultPath, vault.vaultPath, opts),
        );
        expect(JSON.stringify(got, null, 1)).toBe(
          JSON.stringify(want, null, 1),
        );
      } finally {
        vault.cleanup();
      }
    }
  });

  test("empty vault and default options", () => {
    const vault = createTempVault({});
    try {
      expect(
        JSON.stringify(
          isolated(() => getOverview(vault.vaultPath, vault.vaultPath)),
        ),
      ).toBe(
        JSON.stringify(
          isolated(() => originalGetOverview(vault.vaultPath, vault.vaultPath)),
        ),
      );
    } finally {
      vault.cleanup();
    }
  });
});
