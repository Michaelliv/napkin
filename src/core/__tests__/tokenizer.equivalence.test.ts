import { describe, expect, test } from "bun:test";
import { stripNoise, termCounts } from "../tokenizer.js";
import { originalStripNoise, originalTerms } from "./tokenizer-oracle.js";

/**
 * Differential test suite: the optimized tokenizer vs a verbatim copy of the
 * pre-optimization implementation (tokenizer-oracle.ts).
 *
 * Two equivalence claims, each verified here:
 *  1. Guarded stripNoise ≡ unguarded stripNoise (guards are necessary
 *     conditions of their patterns; HEX_HASH may skip digitless text because
 *     HEXLETTER_RUN already removed pure-letter runs).
 *  2. termCounts(text) ≡ occurrence-wise accumulation of terms(text),
 *     including Map INSERTION ORDER (keyword tie-breaking is a stable sort
 *     over Map iteration order, so order is behavior, not a detail).
 */

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
      expect(stripNoise(c)).toBe(originalStripNoise(c));
    }
  });

  test("20,000 fuzzed strings", () => {
    const rand = mulberry32(0x0135e);
    for (let i = 0; i < 20_000; i++) {
      const s = randomText(rand);
      const got = stripNoise(s);
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
      const got = termCounts(s);
      const want = originalCounts(s);
      // insertion order is behavior: keyword tie-breaks depend on it
      expect([...got.keys()]).toEqual([...want.keys()]);
      expect([...got.values()]).toEqual([...want.values()]);
    }
  });

  test("repeated terms keep first-occurrence position", () => {
    const got = termCounts("alpha beta alpha gamma beta alpha");
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

interface WeightedSource {
  text: string;
  weight: number;
}

function randomSources(rand: () => number): WeightedSource[] {
  const sources: WeightedSource[] = [];
  for (let j = int(rand, 1, 6); j > 0; j--) {
    sources.push({ text: randomText(rand, 8), weight: pick(rand, [1, 2, 3]) });
  }
  return sources;
}

/** The original accumulation: occurrence-wise, source by source. */
function weightedOriginal(sources: WeightedSource[]): Map<string, number> {
  const want = new Map<string, number>();
  for (const { text, weight } of sources) {
    for (const t of originalTerms(text)) {
      want.set(t, (want.get(t) || 0) + weight);
    }
  }
  return want;
}

/** The optimized accumulation: count once per source, merge unique entries. */
function weightedMerged(sources: WeightedSource[]): Map<string, number> {
  const got = new Map<string, number>();
  for (const { text, weight } of sources) {
    for (const [t, c] of termCounts(text)) {
      got.set(t, (got.get(t) || 0) + c * weight);
    }
  }
  return got;
}

describe("weighted accumulation \u2261 original buildTF", () => {
  test("2,000 fuzzed source sequences: merged map order and values", () => {
    const rand = mulberry32(0xacc);
    for (let i = 0; i < 2_000; i++) {
      const sources = randomSources(rand);
      const got = weightedMerged(sources);
      const want = weightedOriginal(sources);
      expect([...got.keys()]).toEqual([...want.keys()]);
      expect([...got.values()]).toEqual([...want.values()]);
    }
  });
});
