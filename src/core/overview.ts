import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../utils/config.js";
import { listFiles } from "../utils/files.js";
import { computeFingerprint } from "../utils/fingerprint.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { extractHeadings, extractTags } from "../utils/markdown.js";
import {
  loadOverviewCache,
  saveOverviewCache,
} from "../utils/overview-cache.js";
import { loadSearchCorpus, type SearchCorpus } from "./search.js";
import { termCounts, tokenize } from "./tokenizer.js";

export interface OverviewFolder {
  path: string;
  notes: number;
  keywords: string[];
  /**
   * Notes each keyword fingerprints (parallel to `keywords`). Terms shared
   * by many notes are the row's de-facto domains — they sort first, and
   * `--json` consumers can weight them.
   */
  keywordNotes: number[];
  tags: string[];
  /**
   * The folder's description from _about.md — the `description:`
   * frontmatter property verbatim, or its first prose paragraph.
   */
  about?: string;
  /** Number of subfolders rolled up into this row (homogeneous-sibling collapse). */
  collapsedFolders?: number;
  /**
   * Names of the rolled-up subfolders (largest first). Child folder names are
   * curated entity labels — the most valuable index a collapsed row can show.
   */
  contains?: string[];
}

export interface VaultOverview {
  context?: string;
  overview: OverviewFolder[];
  warnings?: string[];
}

/**
 * Overview tuning. Every field falls back to the vault's config when
 * omitted, so a caller that owns these values in code can pass them
 * explicitly and never inherit a vault's stored defaults.
 */
export interface OverviewOptions {
  /** How many folder levels deep to walk. */
  depth?: number;
  /** Max keywords per folder row; 0 = quality-governed, no cap. */
  keywords?: number;
  /** Roll up numerous, lexically homogeneous sibling folders into one row. */
  collapse?: boolean;
}

// Homogeneous-sibling collapse: parents with at least this many children
// whose term distributions are at least this similar (mean pairwise cosine
// over top terms) are rendered as a single aggregate row. Tuned against a
// corpus of real-world agent vaults — imported document dumps sit at ~0.15–0.25
// similarity, curated folder structures below ~0.05.
const COLLAPSE_MIN_CHILDREN = 5;
const COLLAPSE_SIMILARITY = 0.15;
const COLLAPSE_COSINE_TOP_TERMS = 60;
const COLLAPSE_PAIRWISE_CAP = 20;
const FRONTMATTER_RE = /^---[\s\S]*?---\n?/;
const ATX_HEADING_LINE_RE = /^#{1,6}\s+.+$/gm;
const WIKILINK_ONLY_RE = /^\[\[[^\]]+(?:\|[^\]]+)?\]\]$/;
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

// The index core, validated across a 20-vault fleet of real agent KBs:
// every note proposes its own retrieval fingerprint, probed against the
// vault's own search ranking. bench/overview-exposure.ts scores the
// selected keywords against that ranking.
const PROBE_K = 10;
const MAX_CONTAINS = 12;
const MAX_ABOUT_CHARS = 140;
// The index core's dials: a term present in more than KB_COMMON_RATIO of
// the notes outside the candidate folder is furniture, not a fingerprint;
// each note gets up to FINGERPRINT_TRIES probe attempts to find a handle
// that provably routes to it; per-note candidate pools carry the top
// FINGERPRINT_CANDIDATES terms by count; collapsed dump rows cap their
// index.
const KB_COMMON_RATIO = 0.15;
// Furniture requires scale: below this many outside-the-folder notes a
// term cannot be KB-common.
const KB_COMMON_MIN_DF = 5;
const FINGERPRINT_TRIES = 6;
const FINGERPRINT_CANDIDATES = 32;
const COLLAPSED_INDEX_CAP = 16;
/** Singular/plural variants count as the same displayed word. */
function wordVariants(word: string): string[] {
  return [word, word.endsWith("s") ? word.slice(0, -1) : `${word}s`];
}

/** Edit distance ≤ 1 for words of ≥5 chars ("algoritil" ≈ "algoritl"). */
function nearDuplicate(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  // After the first mismatch, the remainders must agree exactly: one
  // substitution when lengths match, one insertion when they differ.
  return short.length === long.length
    ? short.slice(i + 1) === long.slice(i + 1)
    : short.slice(i) === long.slice(i + 1);
}

// Mixed-case tokens ("haIRbrPU", "qBn5mnRc") are entity-ID shrapnel; their
// lowercase forms are collected vault-wide and never displayed.
const ID_TOKEN_RE = /\b[A-Za-z]{4,}\b/g;

function collectIdTokens(text: string, blocklist: Set<string>): void {
  for (const raw of text.match(ID_TOKEN_RE) || []) {
    // Two or more internal lower→upper humps → machine ID ("haIRbrPU",
    // "qBn5mnRc"). One hump is brand camelCase ("PostgreSQL", "DocuSign").
    const humps = raw.match(/[a-z][A-Z]/g)?.length ?? 0;
    if (humps >= 2 || /^[A-Z]{2,}[a-z]+[A-Z].*[a-z][A-Z]/.test(raw)) {
      blocklist.add(raw.toLowerCase());
    }
  }
}

function isJunkTerm(
  term: string,
  idBlocklist: Set<string>,
  vaultStats: Map<string, TermStats>,
): boolean {
  const words = term.split(" ");
  // "meridian meridian" / "algoritil algoritl" — degenerate bigrams.
  if (words.length === 2 && nearDuplicate(words[0], words[1])) return true;
  for (const word of words) {
    if (idBlocklist.has(word)) return true;
    // Near-vowelless blobs are OCR/ID shrapnel ("jsknwoxz") — unless the
    // word recurs across notes, which shrapnel never does ("strength").
    if (word.length >= 6 && (vaultStats.get(word)?.df ?? 0) < 3) {
      const vowels = (word.match(/[aeiouy]/g) || []).length;
      if (vowels / word.length < 0.2) return true;
    }
  }
  return false;
}

interface TermStats {
  tf: number;
  /** Number of distinct notes containing the term. */
  df: number;
  /**
   * Number of notes whose filename or `title:` property contains the term —
   * "someone named a note after this word". Loose frontmatter values
   * ("captured: Jul 14") carry no naming evidence: they are too credulous
   * a source for domain certification.
   */
  nameDf: number;
}

const emptyTermStats = (): TermStats => ({ tf: 0, df: 0, nameDf: 0 });

/** Accumulate one term's stats into a stats map (folder merge, vault totals). */
function addTermStats(
  target: Map<string, TermStats>,
  term: string,
  s: TermStats,
): void {
  const t = target.get(term) ?? emptyTermStats();
  t.tf += s.tf;
  t.df += s.df;
  t.nameDf += s.nameDf;
  target.set(term, t);
}

/** One note's selection input: candidate terms plus its curated identity. */
interface NoteFingerprint {
  file: string;
  /** Top terms by count (title terms carry their doubled weight). */
  counts: Map<string, number>;
  /** Candidate terms from the filename or `title:` property. */
  nameTerms: Set<string>;
  /** The note's full 1–2-token title, when it is one (roster entry). */
  rosterTitle?: string;
}

interface FolderData {
  stats: Map<string, TermStats>;
  /**
   * Term frequencies from note content (bodies and heading lines, unweighted;
   * no filename or title terms). Used for sibling-collapse similarity so
   * shared naming conventions cannot fake content homogeneity.
   */
  bodyTF: Map<string, number>;
  /**
   * Full note titles of 1–2 tokens ("meridian", "dana arbel") — the
   * folder's entity roster. A fragment of a longer title ("render" from
   * "HTML Deck Rendering") is not a roster entry.
   */
  rosterTitles: Set<string>;
  tags: Set<string>;
  noteCount: number;
  /** Per-note fingerprint records — the index core's selection input. */
  noteCands: NoteFingerprint[];
  /** The row aggregates collapsed subfolders — its index is `contains:`. */
  collapsed?: boolean;
}

/** Per-note term sources, tokenized once and reused by every ancestor row. */
interface NoteData {
  bodyCounts: Map<string, number>;
  /** Filename + frontmatter title/values, already at title weight. */
  titleCounts: Map<string, number>;
  /** Terms from the filename and `title:` property only. */
  nameTerms: Set<string>;
  /** The full note title, when it is 1–2 tokens — an entity name. */
  rosterTitle?: string;
  /** Distinct heading texts (trimmed) in this note. */
  headingKeys: string[];
  tags: Set<string>;
}

/** Folder-path tokens (and plural variants), excluded from keyword display. */
function folderPathTokens(folderPath: string): Set<string> {
  const tokens = new Set<string>();
  for (const segment of folderPath.split("/")) {
    for (const token of tokenize(segment)) {
      for (const v of wordVariants(token)) tokens.add(v);
    }
  }
  return tokens;
}

function shouldSkipOverviewFile(
  file: string,
  folder: string,
  templatesFolder: string,
): boolean {
  const basename = path.basename(file);
  const topLevelFolder = folder === "/" ? "" : folder.split("/")[0];

  return (
    topLevelFolder === templatesFolder ||
    (folder === "/" && basename === "NAPKIN.md") ||
    basename === "_about.md"
  );
}

function frontmatterText(properties: Record<string, unknown>): string[] {
  const values: string[] = [];

  const visit = (value: unknown) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };

  for (const [key, value] of Object.entries(properties)) {
    if (key === "title" || key === "tags") continue;
    visit(value);
  }

  return values.filter((value) => {
    const trimmed = value.trim();
    return (
      trimmed.length > 0 &&
      !WIKILINK_ONLY_RE.test(trimmed) &&
      !ISO_DATE_PREFIX_RE.test(trimmed)
    );
  });
}

function markdownBodyText(content: string): string {
  return content.replace(FRONTMATTER_RE, "").replace(ATX_HEADING_LINE_RE, "");
}

function mergeCounts(
  target: Map<string, number>,
  counts: Map<string, number>,
  weight: number,
): void {
  for (const [term, count] of counts) {
    target.set(term, (target.get(term) || 0) + count * weight);
  }
}

/** Cosine similarity over the top-N terms of two TF maps. */
function tfCosine(a: Map<string, number>, b: Map<string, number>): number {
  const top = (m: Map<string, number>) =>
    new Map(
      [...m.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, COLLAPSE_COSINE_TOP_TERMS),
    );
  const ta = top(a);
  const tb = top(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of ta) na += v * v;
  for (const [, v] of tb) nb += v * v;
  for (const [k, v] of ta) {
    const w = tb.get(k);
    if (w) dot += v * w;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function mergeFolderData(items: FolderData[]): FolderData {
  const stats = new Map<string, TermStats>();
  const bodyTF = new Map<string, number>();
  const rosterTitles = new Set<string>();
  const tags = new Set<string>();
  const noteCands: NoteFingerprint[] = [];
  let noteCount = 0;
  for (const d of items) {
    for (const [term, s] of d.stats) addTermStats(stats, term, s);
    for (const [k, v] of d.bodyTF) bodyTF.set(k, (bodyTF.get(k) || 0) + v);
    for (const t of d.rosterTitles) rosterTitles.add(t);
    for (const t of d.tags) tags.add(t);
    noteCands.push(...d.noteCands);
    noteCount += d.noteCount;
  }
  return { stats, bodyTF, rosterTitles, tags, noteCount, noteCands };
}

interface CollapseRecord {
  /** Total subfolders rolled into this row (cascades included). */
  count: number;
  /** Immediate child segment name → note count, for the `contains` listing. */
  children: Map<string, number>;
}

/**
 * Collapse numerous, lexically homogeneous sibling folders into their parent
 * so repetitive subtrees (imported document dumps, per-entity folder fans)
 * render as one aggregate row instead of dominating the overview. The vault
 * root is never a collapse target: top-level folders are the taxonomy.
 */
function collapseHomogeneousSiblings(folderData: Map<string, FolderData>): {
  data: Map<string, FolderData>;
  collapsed: Map<string, CollapseRecord>;
} {
  const byParent = new Map<string, string[]>();
  for (const folder of folderData.keys()) {
    if (folder === "/") continue;
    const idx = folder.lastIndexOf("/");
    const parent = idx === -1 ? "/" : folder.slice(0, idx);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)?.push(folder);
  }

  // Deepest parents first so collapses can cascade upward.
  const parents = [...byParent.keys()].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );

  const data = new Map(folderData);
  const collapsed = new Map<string, CollapseRecord>();

  for (const parent of parents) {
    if (parent === "/") continue;
    const children = (byParent.get(parent) || []).filter((c) => data.has(c));
    if (children.length < COLLAPSE_MIN_CHILDREN) continue;
    if (meanChildSimilarity(children, data) < COLLAPSE_SIMILARITY) continue;
    mergeChildrenIntoParent(parent, children, data, collapsed);
  }

  return { data, collapsed };
}

/** Mean pairwise body-term cosine over the first COLLAPSE_PAIRWISE_CAP children. */
function meanChildSimilarity(
  children: string[],
  data: Map<string, FolderData>,
): number {
  const cap = Math.min(children.length, COLLAPSE_PAIRWISE_CAP);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < cap; i++) {
    for (let j = i + 1; j < cap; j++) {
      const a = data.get(children[i]);
      const b = data.get(children[j]);
      if (!a || !b) continue;
      sum += tfCosine(a.bodyTF, b.bodyTF);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

/** Merge collapsing children into the parent row, recording the roster. */
function mergeChildrenIntoParent(
  parent: string,
  children: string[],
  data: Map<string, FolderData>,
  collapsed: Map<string, CollapseRecord>,
): void {
  const record = collapsed.get(parent) ?? {
    count: 0,
    children: new Map<string, number>(),
  };
  const toMerge: FolderData[] = [];
  for (const child of children) {
    const d = data.get(child);
    if (!d) continue;
    toMerge.push(d);
    record.count += 1 + (collapsed.get(child)?.count || 0);
    const segment = child.slice(parent.length + 1).split("/")[0];
    record.children.set(
      segment,
      (record.children.get(segment) || 0) + d.noteCount,
    );
    data.delete(child);
    collapsed.delete(child);
  }
  const existing = data.get(parent);
  const merged = existing
    ? mergeFolderData([existing, ...toMerge])
    : mergeFolderData(toMerge);
  data.set(parent, merged);
  collapsed.set(parent, record);
}

/**
 * A folder's description from its _about.md — curated beats derived. The
 * explicit contract is a `description:` frontmatter property, used verbatim.
 * Files without it fall back to the first prose paragraph (hard-wrapped
 * lines joined), capped at a word boundary.
 */
function readAbout(contentPath: string, folder: string): string | undefined {
  const aboutPath = path.join(
    contentPath,
    folder === "/" ? "_about.md" : `${folder}/_about.md`,
  );
  if (!fs.existsSync(aboutPath)) return undefined;
  const raw = fs.readFileSync(aboutPath, "utf-8");
  try {
    const { properties } = parseFrontmatter(raw);
    if (typeof properties.description === "string" && properties.description) {
      return properties.description.trim();
    }
  } catch {
    // fall through to paragraph extraction
  }
  const body = raw.replace(FRONTMATTER_RE, "");
  const paragraph: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  if (paragraph.length === 0) return undefined;
  const text = paragraph.join(" ");
  if (text.length <= MAX_ABOUT_CHARS) return text;
  const cut = text.lastIndexOf(" ", MAX_ABOUT_CHARS - 1);
  return `${text.slice(0, cut > 40 ? cut : MAX_ABOUT_CHARS - 1)}…`;
}

function groupFilesByFolder(
  files: string[],
  templatesFolder: string,
): Map<string, string[]> {
  const folderFiles = new Map<string, string[]>();

  for (const file of files) {
    const dir = path.dirname(file);
    const folder = dir === "." ? "/" : dir;
    if (shouldSkipOverviewFile(file, folder, templatesFolder)) continue;

    if (!folderFiles.has(folder)) folderFiles.set(folder, []);
    folderFiles.get(folder)?.push(file);
  }

  return folderFiles;
}

/**
 * A note's fingerprint record: its top terms by count, capped so
 * vault-scale memory stays bounded, with name terms always retained.
 * Scoring happens at selection time, where idf is known.
 */
function fingerprintRecord(file: string, note: NoteData): NoteFingerprint {
  const merged = new Map<string, number>(note.bodyCounts);
  for (const [t, c] of note.titleCounts) {
    merged.set(t, (merged.get(t) || 0) + c);
  }
  const top = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  const counts = new Map(top.slice(0, FINGERPRINT_CANDIDATES));
  for (const t of note.nameTerms) {
    const c = merged.get(t);
    if (c !== undefined) counts.set(t, c);
  }
  const nameTerms = new Set([...note.nameTerms].filter((t) => counts.has(t)));
  return { file, counts, nameTerms, rosterTitle: note.rosterTitle };
}

/**
 * Tokenize one note's term sources. Bodies count at weight 1. Filenames and
 * frontmatter (title + values) count at title weight 2 — curated metadata is
 * title-grade evidence. Heading terms feed folder statistics (df for the
 * KB-common test, collapse similarity) but carry no naming evidence:
 * repeated section headings are template boilerplate.
 */
function buildNoteData(
  file: string,
  content: string,
  idBlocklist: Set<string>,
  headingTermCache: Map<string, Map<string, number>>,
  warnings: string[],
): NoteData | null {
  const basename = path.basename(file, ".md");
  collectIdTokens(`${basename} ${content}`, idBlocklist);

  let properties: Record<string, unknown> = {};
  try {
    ({ properties } = parseFrontmatter(content));
  } catch {
    warnings.push(`Skipping ${file} (malformed YAML frontmatter)`);
    return null;
  }

  const tags = new Set<string>(extractTags(content));
  if (Array.isArray(properties.tags)) {
    for (const tag of properties.tags) tags.add(String(tag));
  }

  const titleCounts = new Map<string, number>();
  mergeCounts(titleCounts, termCounts(basename), 2);
  if (properties.title) {
    mergeCounts(titleCounts, termCounts(String(properties.title)), 2);
  }
  const nameTerms = new Set(titleCounts.keys());
  const nameTokens = tokenize(basename);
  // A digit-bearing basename that tokenizes to a single word
  // ("vex-0.14" → "vex") lost its identity to the tokenizer — no roster
  // shortcut; it must be fingerprinted from content. Two surviving tokens
  // ("soc2-readiness" → "soc readiness") still carry the identity.
  const digitCollapsed = nameTokens.length === 1 && /\d/.test(basename);
  const rosterTitle =
    nameTokens.length >= 1 && nameTokens.length <= 2 && !digitCollapsed
      ? nameTokens.join(" ")
      : undefined;
  for (const value of frontmatterText(properties)) {
    mergeCounts(titleCounts, termCounts(value), 2);
  }

  const headingKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const heading of extractHeadings(content)) {
    const key = heading.text.trim();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    headingKeys.push(key);
    if (!headingTermCache.has(key)) {
      headingTermCache.set(key, termCounts(heading.text));
    }
  }

  return {
    bodyCounts: termCounts(markdownBodyText(content)),
    titleCounts,
    nameTerms,
    rosterTitle,
    headingKeys,
    tags,
  };
}

/**
 * Fold one term-count source into folder stats with df/nameDf bookkeeping.
 * `seen`/`seenTitle` deduplicate per note across sources.
 */
function addTermSource(
  stats: Map<string, TermStats>,
  counts: Map<string, number>,
  weight: number,
  source: "body" | "title" | "heading",
  seen: Set<string>,
  seenTitle: Set<string>,
  nameTerms: Set<string>,
): void {
  for (const [term, count] of counts) {
    const s = stats.get(term) ?? emptyTermStats();
    stats.set(term, s);
    s.tf += count * weight;
    if (!seen.has(term)) {
      s.df += 1;
      seen.add(term);
    }
    if (source === "title" && !seenTitle.has(term)) {
      seenTitle.add(term);
      if (nameTerms.has(term)) s.nameDf += 1;
    }
  }
}

function buildFolderData(
  notes: NoteData[],
  headingTermCache: Map<string, Map<string, number>>,
): FolderData {
  const stats = new Map<string, TermStats>();
  const bodyTF = new Map<string, number>();
  const rosterTitles = new Set<string>();
  const tags = new Set<string>();

  for (const note of notes) {
    if (note.rosterTitle) rosterTitles.add(note.rosterTitle);
    const seen = new Set<string>();
    const seenTitle = new Set<string>();
    const add = (
      counts: Map<string, number>,
      weight: number,
      source: "body" | "title" | "heading",
    ) =>
      addTermSource(
        stats,
        counts,
        weight,
        source,
        seen,
        seenTitle,
        note.nameTerms,
      );

    add(note.bodyCounts, 1, "body");
    add(note.titleCounts, 1, "title"); // titleCounts already carry weight 2
    mergeCounts(bodyTF, note.bodyCounts, 1);
    for (const key of note.headingKeys) {
      const counts = headingTermCache.get(key);
      if (!counts) continue;
      add(counts, 2, "heading");
      mergeCounts(bodyTF, counts, 1);
    }
    for (const t of note.tags) tags.add(t);
  }

  return {
    stats,
    bodyTF,
    rosterTitles,
    tags,
    noteCands: [],
    noteCount: notes.length,
  };
}

// ─── Keyword selection ───────────────────────────────────────────────

interface SelectionContext {
  corpus: SearchCorpus;
  probeCache: Map<string, string[]>;
  vaultStats: Map<string, TermStats>;
  vaultNotes: number;
  idBlocklist: Set<string>;
  maxKeywords: number;
}

function probeTopK(ctx: SelectionContext, query: string): string[] {
  const hit = ctx.probeCache.get(query);
  if (hit) return hit;
  const out = ctx.corpus
    .rank(query)
    .slice(0, PROBE_K)
    .map((r) => r.file);
  ctx.probeCache.set(query, out);
  return out;
}

/**
 * The index core: the overview is an index, not a summary. Each note
 * proposes its own retrieval fingerprint — its top terms by tf × idf, the
 * tokens that would score highest for that note under BM25 — and the row
 * is the union of its notes' fingerprints. Two subtractions govern
 * quality: KB-common terms (vault furniture — present in more than
 * KB_COMMON_RATIO of all notes) cannot be anybody's fingerprint, and the
 * junk gates drop shrapnel. The search probe then validates each
 * fingerprint: the note itself must surface in the term's top hits.
 * Fingerprint proposes, probe disposes.
 *
 * Roster doctrine: full 1–2-token note titles are curated handles —
 * exempt from the KB-common subtraction in their home folder, and always
 * listed.
 */
function selectKeywords(
  ctx: SelectionContext,
  folder: string,
  data: FolderData,
  taken: Set<string>,
): { keywords: string[]; keywordNotes: number[] } {
  const excluded = folderPathTokens(folder);

  const idf = (term: string): number => {
    const df = ctx.vaultStats.get(term)?.df ?? 0;
    return Math.log(1 + (ctx.vaultNotes - df + 0.5) / (df + 0.5));
  };
  // KB-common is measured OUTSIDE the folder: a dominant folder (83% of
  // the vault) still owns its own recurring vocabulary, while true
  // furniture is common everywhere else too. The df floor keeps tiny
  // vaults — where the domain itself is in every note — out of the ban.
  const kbCommon = (term: string): boolean => {
    if (data.rosterTitles.has(term)) return false;
    const v = ctx.vaultStats.get(term);
    const outsideDf = Math.max(
      0,
      (v?.df ?? 0) - (data.stats.get(term)?.df ?? 0),
    );
    if (outsideDf < KB_COMMON_MIN_DF) return false;
    const share = outsideDf / Math.max(1, ctx.vaultNotes - data.noteCount);
    // Title evidence rescues borderline-common domain words ("schedule",
    // "sensor"): named by multiple notes and only modestly over the bar.
    // Nothing rescues true furniture — a word in half the vault ("vex")
    // stays banned however many titles carry it.
    if ((v?.nameDf ?? 0) >= 2 && share <= 2 * KB_COMMON_RATIO) return false;
    return share > KB_COMMON_RATIO;
  };

  // term → number of notes it fingerprints (the index's share counts).
  const chosen = new Map<string, number>();
  const seenKeys = new Set<string>();

  /** Word-set identity: "rows cols" ≡ "cols rows", "grape" ≡ "grapes". */
  const dedupeKey = (term: string): string =>
    term
      .split(" ")
      .map((w) => (w.endsWith("s") ? w.slice(0, -1) : w))
      .sort()
      .join(" ");
  /** OCR variants of a chosen word ("komplet" ≈ "complet") add nothing. */
  const nearDupOfChosen = (term: string): boolean =>
    !term.includes(" ") &&
    [...chosen.keys()].some((c) => !c.includes(" ") && nearDuplicate(term, c));

  const admissible = (term: string): boolean => {
    if (taken.has(term)) return false;
    const words = term.split(" ");
    if (words.some((w) => excluded.has(w))) return false;
    if (isJunkTerm(term, ctx.idBlocklist, ctx.vaultStats)) return false;
    // Roster titles pass whole: an entity's home row shows its name.
    if (data.rosterTitles.has(term)) return true;
    // A phrase wrapping a furniture word ("berth acme") smuggles the
    // furniture back in — the subtraction applies to every word.
    return (
      !kbCommon(term) && !words.some((w) => words.length > 1 && kbCommon(w))
    );
  };

  /**
   * A note already reachable through a chosen term strengthens that term
   * instead of adding a synonym row — but reachability is probed, never
   * assumed: containing the word is not being found by it.
   */
  const creditExistingHandle = (note: NoteFingerprint): boolean => {
    for (const t of chosen.keys()) {
      if (
        note.counts.has(t) &&
        probeTopK(ctx, t).slice(0, 3).includes(note.file)
      ) {
        chosen.set(t, (chosen.get(t) ?? 0) + 1);
        return true;
      }
    }
    return false;
  };

  /**
   * The note's handle: its admissible candidates scored by tf × idf with
   * the note's curated name boosted — without the boost, a rare body
   * unigram ("dip", "candle") outbids the note's own title bigram ("night
   * bakery"): routable but mute. Fingerprint proposes, probe disposes: the
   * first candidate whose top hits include the note wins. When none
   * validates (the note loses every BM25 race to neighbors), the best
   * fingerprint still represents it — an unroutable handle beats
   * invisibility.
   */
  const chooseHandle = (note: NoteFingerprint): string | undefined => {
    const handleBoost = (t: string): number =>
      note.nameTerms.has(t) ? (t.includes(" ") ? 2.5 : 1.8) : 1;
    const scored = [...note.counts]
      .filter(
        ([t]) =>
          admissible(t) && !seenKeys.has(dedupeKey(t)) && !nearDupOfChosen(t),
      )
      .map(([t, c]) => [t, Math.log(1 + c) * idf(t) * handleBoost(t)] as const)
      .sort((a, b) => b[1] - a[1]);
    for (const [t] of scored.slice(0, FINGERPRINT_TRIES)) {
      if (probeTopK(ctx, t).slice(0, 3).includes(note.file)) return t;
    }
    return scored[0]?.[0];
  };

  /**
   * Roster completion: full note titles are curated handles by
   * definition — one-note-per-entity folders list their entities.
   * `admissible` lets them through: kbCommon exempts roster titles.
   */
  const completeRoster = (): void => {
    for (const title of data.rosterTitles) {
      if (chosen.has(title) || seenKeys.has(dedupeKey(title))) continue;
      if (!admissible(title)) continue;
      chosen.set(title, 1);
      seenKeys.add(dedupeKey(title));
    }
  };

  for (const note of data.noteCands) {
    // A roster-titled note is covered by its own title — roster
    // completion lists it. Its body fingerprint is episode, not
    // identity ("truck temperature" on a person's note).
    if (note.rosterTitle) continue;
    if (creditExistingHandle(note)) continue;
    const pick = chooseHandle(note);
    if (pick === undefined) continue;
    chosen.set(pick, 1);
    seenKeys.add(dedupeKey(pick));
  }
  completeRoster();

  // Most-shared first: terms that fingerprint many notes are the row's
  // de-facto domains; singletons trail in note order.
  let entries = [...chosen.entries()].sort((a, b) => b[1] - a[1]);

  // A collapsed row aggregates dump-shaped subtrees; its index is the
  // `contains:` roster, so the fingerprint index stays a taste.
  if (data.collapsed) entries = entries.slice(0, COLLAPSED_INDEX_CAP);
  if (ctx.maxKeywords > 0) entries = entries.slice(0, ctx.maxKeywords);

  return {
    keywords: entries.map(([t]) => t),
    keywordNotes: entries.map(([, n]) => n),
  };
}

// ─── Assembly ────────────────────────────────────────────────────────

interface VaultData {
  folderData: Map<string, FolderData>;
  vaultStats: Map<string, TermStats>;
  vaultNotes: number;
  idBlocklist: Set<string>;
  warnings: string[];
}

/** One pass over every note: per-folder statistics plus vault totals. */
function collectVaultData(
  contentPath: string,
  folderFiles: Map<string, string[]>,
  maxDepth: number,
): VaultData {
  const warnings: string[] = [];
  const idBlocklist = new Set<string>();
  const headingTermCache = new Map<string, Map<string, number>>();
  const vaultStats = new Map<string, TermStats>();
  let vaultNotes = 0;

  const folderData = new Map<string, FolderData>();
  for (const [folder, folderFileList] of folderFiles) {
    const depth = folder === "/" ? 0 : folder.split("/").length;
    if (depth > maxDepth) continue;

    const notes: NoteData[] = [];
    const noteCands: FolderData["noteCands"] = [];
    for (const file of folderFileList) {
      const content = fs.readFileSync(path.join(contentPath, file), "utf-8");
      const note = buildNoteData(
        file,
        content,
        idBlocklist,
        headingTermCache,
        warnings,
      );
      if (!note) continue;
      notes.push(note);
      noteCands.push(fingerprintRecord(file, note));
    }

    const data = buildFolderData(notes, headingTermCache);
    // A malformed note is skipped for keywords/tags but still counted.
    data.noteCount = folderFileList.length;
    data.noteCands = noteCands;
    folderData.set(folder, data);

    for (const [term, s] of data.stats) addTermStats(vaultStats, term, s);
    vaultNotes += folderFileList.length;
  }

  return { folderData, vaultStats, vaultNotes, idBlocklist, warnings };
}

/** Terms already displayed on descendant rows — a parent must add new info. */
function claimedByDescendants(
  keywordsByFolder: Map<string, { keywords: string[] }>,
  folder: string,
): Set<string> {
  const taken = new Set<string>();
  for (const [other, row] of keywordsByFolder) {
    const isDescendant = folder === "/" ? true : other.startsWith(`${folder}/`);
    if (isDescendant) for (const t of row.keywords) taken.add(t);
  }
  return taken;
}

function buildOverviewFolders(
  contentPath: string,
  configPath: string,
  maxDepth: number,
  maxKeywords: number,
  templatesFolder: string,
  collapse: boolean,
): { folders: OverviewFolder[]; warnings: string[] } {
  const files = listFiles(contentPath, { ext: "md" });
  const folderFiles = groupFilesByFolder(files, templatesFolder);
  const vault = collectVaultData(contentPath, folderFiles, maxDepth);
  const { vaultStats, vaultNotes, idBlocklist, warnings } = vault;
  let { folderData } = vault;

  let collapsedCounts = new Map<string, CollapseRecord>();
  if (collapse) {
    const result = collapseHomogeneousSiblings(folderData);
    folderData = result.data;
    collapsedCounts = result.collapsed;
  }

  if (folderData.size === 0) return { folders: [], warnings };

  const ctx: SelectionContext = {
    corpus: loadSearchCorpus(contentPath, configPath),
    probeCache: new Map(),
    vaultStats,
    vaultNotes,
    idBlocklist,
    maxKeywords,
  };

  // Children select first (deepest paths), claiming their terms; ancestor
  // rows must then contribute information not already visible on a
  // descendant row.
  const byDepthDesc = [...folderData.keys()].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );
  const keywordsByFolder = new Map<
    string,
    { keywords: string[]; keywordNotes: number[] }
  >();
  for (const folder of byDepthDesc) {
    const data = folderData.get(folder);
    if (!data) continue;
    data.collapsed = collapsedCounts.has(folder);
    const taken = claimedByDescendants(keywordsByFolder, folder);
    keywordsByFolder.set(folder, selectKeywords(ctx, folder, data, taken));
  }

  const folders: OverviewFolder[] = [];
  for (const [folder, data] of [...folderData.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const about = readAbout(contentPath, folder);
    const record = collapsedCounts.get(folder);
    const contains = record
      ? [...record.children.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_CONTAINS)
          .map(([name]) => name)
      : undefined;
    const row = keywordsByFolder.get(folder) ?? {
      keywords: [],
      keywordNotes: [],
    };
    folders.push({
      path: folder,
      notes: data.noteCount,
      keywords: row.keywords,
      keywordNotes: row.keywordNotes,
      tags: [...data.tags].sort(),
      ...(about ? { about } : {}),
      ...(record ? { collapsedFolders: record.count, contains } : {}),
    });
  }

  return { folders, warnings };
}

export function getOverview(
  contentPath: string,
  configPath: string,
  opts?: OverviewOptions,
): VaultOverview {
  const config = loadConfig(configPath);
  const maxDepth = opts?.depth ?? config.overview.depth;
  const maxKeywords = opts?.keywords ?? config.overview.keywords;
  const collapse = opts?.collapse ?? config.overview.collapse;

  // Whole-vault cache: one stat pass instead of reading + tokenizing every
  // note. Any file add/remove/touch changes the fingerprint; NAPKIN.md is a
  // vault .md file, so context changes invalidate too. Resolved options are
  // part of the key because they change the result; the version prefix
  // invalidates results from older keyword algorithms.
  const fingerprint = computeFingerprint(contentPath);
  const optionsKey = `v6|${maxDepth}|${maxKeywords}|${collapse}|${config.templates.folder}`;
  const cached = loadOverviewCache<VaultOverview>(
    configPath,
    fingerprint,
    optionsKey,
  );
  if (cached) return cached;

  const { folders, warnings } = buildOverviewFolders(
    contentPath,
    configPath,
    maxDepth,
    maxKeywords,
    config.templates.folder,
    collapse,
  );

  const contextPath = path.join(contentPath, "NAPKIN.md");
  const context = fs.existsSync(contextPath)
    ? fs.readFileSync(contextPath, "utf-8").trim()
    : undefined;

  const result: VaultOverview = {
    ...(context ? { context } : {}),
    overview: folders,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  saveOverviewCache(configPath, { fingerprint, optionsKey, result });
  return result;
}
