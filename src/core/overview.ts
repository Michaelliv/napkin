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

export interface OverviewTopic {
  /** Name-backed label — a phrase people actually title notes with. */
  label: string;
  /** Notes that substantially discuss the topic (title mention or tf ≥ 2). */
  notes: number;
  /** Selected keywords whose notes live inside this topic. */
  terms: string[];
}

export interface OverviewFolder {
  path: string;
  notes: number;
  keywords: string[];
  tags: string[];
  /**
   * Topical decomposition: multi-topic folders (procedures, meeting dumps,
   * incident logs) are mixtures, and a flat term list destroys the
   * structure an agent routes by. Topics carry content-grounded note
   * counts; keywords holds the cross-topic vocabulary.
   */
  topics?: OverviewTopic[];
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

// Keyword selection, tuned across a 20-vault fleet of real agent KBs:
// search-probe depth, candidate pool per tier, filter thresholds, and the
// quality stops that govern row depth. bench/overview-exposure.ts scores the
// selected keywords against the vault's own search ranking.
const PROBE_K = 10;
const CANDIDATE_POOL = 300;
const MIN_KEYWORDS = 4;
const MAX_CONTAINS = 12;
const MAX_ABOUT_CHARS = 140;
// Vault-wide quality bar as a fraction of the median row-best gain.
const QUALITY_BAR_RATIO = 0.15;
// Relative floor against the row's k-th best gain — outlier-robust, so a
// single spectacular head term cannot cut off a deep domain; catches rows
// whose weak tail still clears a low vault bar.
const RELATIVE_STOP_RATIO = 0.15;

const VAULT_COMMON_RATIO = 0.12;
const VAULT_COMMON_RATIO_RELAXED = 0.25;
// Topic heads: a label must be name-backed in this share of the folder's
// notes, cover at least this many, and no single topic may swallow the row.
const TOPIC_MIN_SHARE = 0.04;
const TOPIC_MIN_NOTES = 3;
const TOPIC_MAX_SHARE = 0.6;
const MAX_TOPICS = 8;
const TOPIC_TERM_CONTAINMENT = 0.6;
const MAX_TOPIC_TERMS = 6;
// Ubiquity ban for topic heads: a term strongly present in most folders
// (median folder share at or above this) is an operator or company name —
// vault furniture, not a topic. Measured on the fleet: an operator's first
// name sits at median 0.79 while real product-line topics stay near 0.3
// even in the vault dedicated to them.
const TOPIC_UBIQUITY_MEDIAN = 0.5;
// Dispersal testing (concentration bars) needs enough vault-wide evidence
// to judge a word. The floor scales with vault size (5% of notes) so small
// vaults still test their dispersed words, bounded to [4, 8]. The naming-
// evidence requirement applies from a lower floor: even thin evidence can
// show that nobody ever marks a word as a name.
const NON_DOMAIN_MIN_VAULT_DF = 8;
const NON_DOMAIN_MIN_VAULT_DF_FLOOR = 4;
const NAME_EVIDENCE_MIN_DF = 2;
// A word with zero name evidence vault-wide (nobody ever titled a note with
// it) needs near-total concentration to count as domain vocabulary.
const BODY_ONLY_CONC = 0.85;
// Share of a word's occurrences that must be capitalized mid-sentence to
// count as proper-noun typography.
const CAP_EVIDENCE_RATIO = 0.05;
// Ceiling on the non-domain concentration bar. The size lift (1.5 × share)
// must stay attainable in dominant-folder vaults — at 80% share the raw bar
// is 1.2, which would ban every dispersed word in the vault's biggest
// domain. Ownership with margin is still required, never impossibility.
const NON_DOMAIN_BAR_CAP = 0.9;

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

// A capitalized word mid-sentence is proper-noun typography — the author
// flagged it as a name. Not counted after sentence punctuation, colons,
// list markers, table pipes, brackets, or quotes: those capitalize
// structurally ("| Yes |"), not nominally.
const MID_SENTENCE_CAP_RE = /[^.!?\n:\-•*|()[\]"']\s([A-Z][A-Za-z']+)\b/g;

function collectCapEvidence(text: string, capTf: Map<string, number>): void {
  for (const match of text.matchAll(MID_SENTENCE_CAP_RE)) {
    const word = match[1].toLowerCase();
    capTf.set(word, (capTf.get(word) || 0) + 1);
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
   * "someone named a note after this word". Stricter than titleDf, which
   * also counts arbitrary frontmatter values ("captured: Jul 14") and is
   * too credulous for domain certification.
   */
  nameDf: number;
  /** Number of notes whose filename or frontmatter contains the term. */
  titleDf: number;
  /** The term appears outside headings (body, filename, or frontmatter). */
  nonHeading: boolean;
}

const emptyTermStats = (): TermStats => ({
  tf: 0,
  df: 0,
  nameDf: 0,
  titleDf: 0,
  nonHeading: false,
});

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
  t.titleDf += s.titleDf;
  t.nonHeading = t.nonHeading || s.nonHeading;
  target.set(term, t);
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
   * Per-note strong-term sets (name terms plus content terms with tf ≥ 2):
   * a note is a member of a topic it is titled with or substantially
   * discusses. Drives topic membership counts.
   */
  strongTerms: Set<string>[];
  /**
   * Full note titles of 1–2 tokens ("gong", "ilia kesler") — the folder's
   * entity roster. A fragment of a longer title ("render" from "HTML Deck
   * Rendering") is not a roster entry.
   */
  rosterTitles: Set<string>;
  /** Distinct heading texts (trimmed) across the folder's notes. */
  headingKeys: Set<string>;
  tags: Set<string>;
  noteCount: number;
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

/** Generic structural segment names — never anchors, never topic labels. */
const GENERIC_SEGMENTS = new Set([
  "meetings",
  "meeting",
  "notes",
  "crm",
  "docs",
  "files",
  "misc",
  "general",
  "quotes",
  "transcripts",
  "daily",
]);

function anchorToken(folderPath: string): string | undefined {
  for (const segment of folderPath.split("/").reverse()) {
    const token = tokenize(segment).find((t) => !GENERIC_SEGMENTS.has(t));
    if (token) return token;
  }
  return undefined;
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
  const strongTerms: Set<string>[] = [];
  const rosterTitles = new Set<string>();
  const headingKeys = new Set<string>();
  const tags = new Set<string>();
  let noteCount = 0;
  for (const d of items) {
    for (const [term, s] of d.stats) addTermStats(stats, term, s);
    for (const [k, v] of d.bodyTF) bodyTF.set(k, (bodyTF.get(k) || 0) + v);
    strongTerms.push(...d.strongTerms);
    for (const t of d.rosterTitles) rosterTitles.add(t);
    for (const k of d.headingKeys) headingKeys.add(k);
    for (const t of d.tags) tags.add(t);
    noteCount += d.noteCount;
  }
  return {
    stats,
    bodyTF,
    strongTerms,
    rosterTitles,
    headingKeys,
    tags,
    noteCount,
  };
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
 * Tokenize one note's term sources. Bodies count at weight 1. Filenames and
 * frontmatter (title + values) count at title weight 2 — curated metadata is
 * title-grade evidence. Heading terms count at weight 2 but carry no title
 * evidence: repeated section headings are template boilerplate, gated later
 * by heading corroboration.
 */
function buildNoteData(
  file: string,
  content: string,
  idBlocklist: Set<string>,
  capTf: Map<string, number>,
  headingTermCache: Map<string, Map<string, number>>,
  warnings: string[],
): NoteData | null {
  const basename = path.basename(file, ".md");
  collectIdTokens(`${basename} ${content}`, idBlocklist);
  collectCapEvidence(content, capTf);

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
  const rosterTitle =
    nameTokens.length >= 1 && nameTokens.length <= 2
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
 * Fold one term-count source into folder stats with df/titleDf/nameDf
 * bookkeeping. `seen`/`seenTitle` deduplicate per note across sources.
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
      s.titleDf += 1;
      seenTitle.add(term);
      if (nameTerms.has(term)) s.nameDf += 1;
    }
    if (source !== "heading") s.nonHeading = true;
  }
}

function buildFolderData(
  notes: NoteData[],
  headingTermCache: Map<string, Map<string, number>>,
): FolderData {
  const stats = new Map<string, TermStats>();
  const bodyTF = new Map<string, number>();
  const strongTerms: Set<string>[] = [];
  const rosterTitles = new Set<string>();
  const headingKeys = new Set<string>();
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
    const strong = new Set(note.nameTerms);
    for (const [t, c] of note.bodyCounts) if (c >= 2) strong.add(t);
    strongTerms.push(strong);
    for (const key of note.headingKeys) {
      const counts = headingTermCache.get(key);
      if (!counts) continue;
      add(counts, 2, "heading");
      mergeCounts(bodyTF, counts, 1);
      headingKeys.add(key);
    }
    for (const t of note.tags) tags.add(t);
  }

  return {
    stats,
    bodyTF,
    strongTerms,
    rosterTitles,
    headingKeys,
    tags,
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
  headingTermCache: Map<string, Map<string, number>>;
  maxKeywords: number;
  /** Vault-wide count of mid-sentence capitalized occurrences per word. */
  capTf: Map<string, number>;
  /**
   * Strong-membership share of a term per sizeable folder, sorted
   * descending — the topic ubiquity test's evidence. Cached per term.
   */
  strongShares: (term: string) => number[];
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

const inFolder = (file: string, folder: string): boolean =>
  folder === "/" ? !file.includes("/") : file.startsWith(`${folder}/`);

/**
 * Rank-limited precision: hits inside the folder among the top
 * min(PROBE_K, 2×folder size) results — a 1-note folder is judged on whether
 * its note surfaces near the top, not on filling all of the window.
 */
function rankedPrecision(
  results: string[],
  folder: string,
  notes: number,
): { hits: string[]; precision: number } {
  const window = Math.min(PROBE_K, Math.max(4, notes * 2));
  const top = results.slice(0, window);
  const hits = top.filter((f) => inFolder(f, folder));
  return { hits, precision: top.length > 0 ? hits.length / top.length : 0 };
}

function routability(
  ctx: SelectionContext,
  term: string,
  folder: string,
  notes: number,
  anchor: string | undefined,
): { hits: string[]; precision: number } {
  const direct = rankedPrecision(probeTopK(ctx, term), folder, notes);
  if (direct.precision >= 0.5 || !anchor || term.includes(anchor)) {
    return direct;
  }

  // Agents compose queries with the folder's anchor ("meridian msa").
  const composed = rankedPrecision(
    probeTopK(ctx, `${anchor} ${term}`),
    folder,
    notes,
  );
  return composed.precision > direct.precision ? composed : direct;
}

/**
 * Language-agnostic non-domain word test: speech verbs, pronouns, and hedge
 * words ("tells", "ourselves", "actually") occur across many notes but never
 * in a single filename vault-wide, and are dispersed — no folder owns them.
 * Topical body-only vocabulary ("cashflow") is rescued by concentration with
 * lift: its share of vault-wide mass must exceed what the folder's sheer size
 * predicts — otherwise a giant folder "owns" every word, including its own
 * boilerplate ("hereby" in a 549-note contract dump).
 */
function isNonDomainWord(
  ctx: SelectionContext,
  word: string,
  folderStats: Map<string, TermStats>,
  folderShare: number,
  rosterWords: Set<string>,
): boolean {
  const v = ctx.vaultStats.get(word);
  if (!v) return false;
  // A folder holding a note fully titled with the word owns it as a handle
  // by construction — an entity's home row shows its name however widely
  // the entity is discussed elsewhere.
  if (rosterWords.has(word)) return false;
  // Naming evidence: a note titled with the word (any singular/plural
  // variant) or proper-noun typography (capitalized mid-sentence at ≥ 5% of
  // occurrences). A recurring word nobody ever marks as a name — "checked",
  // "further", "proceed" — is prose machinery, however concentrated its
  // folder. Case evidence only applies where the script has case; caseless
  // words (Hebrew) rely on the statistical tests below.
  const nameEvidence = wordVariants(word).some(
    (variant) => (ctx.vaultStats.get(variant)?.nameDf ?? 0) >= 1,
  );
  const capRatio = (ctx.capTf.get(word) ?? 0) / v.tf;
  const caseable = /[a-z]/.test(word);
  if (
    caseable &&
    v.df >= NAME_EVIDENCE_MIN_DF &&
    !nameEvidence &&
    capRatio < CAP_EVIDENCE_RATIO
  ) {
    return true;
  }
  const minVaultDf = Math.max(
    NON_DOMAIN_MIN_VAULT_DF_FLOOR,
    Math.min(NON_DOMAIN_MIN_VAULT_DF, Math.round(0.05 * ctx.vaultNotes)),
  );
  if (v.df < minVaultDf) return false;
  // Name evidence must scale with commonness: one sentence-shaped filename
  // ("…tells DIY story…") does not certify a word that appears in 60 notes.
  // Only real note names certify — frontmatter values ("captured: Jul 14")
  // are too credulous a source.
  if (v.nameDf >= Math.max(2, 0.02 * v.df)) return false;
  const local = folderStats.get(word);
  const conc = local ? local.tf / v.tf : 0;
  // Concentration rescue: body-only domain vocabulary ("tedious", the MSSQL
  // library) is near-totally concentrated; genre words that merely lean
  // toward one folder ("him" → people/) are not. Name-backed words get the
  // lenient bar.
  const base = v.nameDf >= 2 ? 0.3 : BODY_ONLY_CONC;
  return conc < Math.min(NON_DOMAIN_BAR_CAP, Math.max(base, 1.5 * folderShare));
}

interface ScoredCandidate {
  term: string;
  hits: string[];
  precision: number;
  salience: number;
  /** The term is a full note title — a roster entry, curated by definition. */
  isRosterTerm: boolean;
}

interface PrelimCandidate {
  term: string;
  tf: number;
  df: number;
  salience: number;
}

/**
 * Phrase preference: when a unigram's occurrences mostly live inside one
 * recurring bigram ("visit" → "reference visit"), the specific phrase is
 * the better domain label — promote it above its unigram. A bigram seen
 * once is a clause adjacency, not a phrase.
 */
function applyPhrasePreference(prelim: PrelimCandidate[]): void {
  const byTerm = new Map(prelim.map((e) => [e.term, e]));
  for (const e of prelim) {
    if (!e.term.includes(" ") || e.tf < 2) continue;
    for (const part of e.term.split(" ")) {
      const uni = byTerm.get(part);
      if (uni && e.df >= 0.6 * uni.df) {
        e.salience = Math.max(e.salience, uni.salience * 1.05);
      }
    }
  }
}

/**
 * The pool cap bounds probe work for derived vocabulary; roster terms (full
 * note titles) always stay — chatty folders must not push their own entity
 * roster below the salience cut.
 */
function poolWithRoster(
  prelim: PrelimCandidate[],
  rosterTitles: Set<string>,
): PrelimCandidate[] {
  const pooled = prelim.slice(0, CANDIDATE_POOL);
  const inPool = new Set(pooled.map((e) => e.term));
  for (const e of prelim.slice(CANDIDATE_POOL)) {
    if (rosterTitles.has(e.term) && !inPool.has(e.term)) {
      pooled.push(e);
    }
  }
  return pooled;
}

/**
 * Pick the folder's keywords: the smallest set of words/phrases with which an
 * agent both recognizes the domain from a request and lands in the folder by
 * searching them. Candidates are ranked by salience —
 *   conc^0.3 × log(1+tf) × burst^0.7 × √log(1+df) × titleBoost
 * — gated by junk filters and statistical priors, then greedily selected by
 * salience × coverage-diversity × (0.35 + routability). Depth is governed by
 * quality, not a count budget: the row ends when marginal gain drops below
 * both the vault-wide qualityBar and the relative floor. Statistical priors
 * relax in tiers when a row starves (sparse vaults, over-claimed siblings);
 * the junk gates never relax.
 */
function selectKeywords(
  ctx: SelectionContext,
  folder: string,
  data: FolderData,
  taken: Set<string>,
  qualityBar = 0,
): { keywords: string[]; firstGain: number } {
  const { stats, noteCount: notes } = data;
  const excluded = folderPathTokens(folder);
  const anchor = anchorToken(folder);

  // Number of distinct heading texts containing each term, for heading
  // corroboration: a heading-only term must recur across ≥2 distinct
  // headings, or it's a section label ("Context", "Decision").
  const headingLines = new Map<string, number>();
  for (const key of data.headingKeys) {
    const counts = ctx.headingTermCache.get(key);
    if (!counts) continue;
    for (const term of counts.keys()) {
      headingLines.set(term, (headingLines.get(term) || 0) + 1);
    }
  }

  // Floors: a keyword must be domain-wide (df) and non-trivial (tf).
  // Capped at 5 so entity names still qualify in very large folders.
  const minDf =
    notes >= 8 ? Math.min(5, Math.max(2, Math.ceil(notes * 0.1))) : 1;
  const folderShare = notes / Math.max(1, ctx.vaultNotes);
  // Words of the folder's entity roster (full 1–2 token note titles).
  const rosterWords = new Set<string>();
  for (const t of data.rosterTitles) {
    for (const w of t.split(" ")) rosterWords.add(w);
  }

  // Never-relax gates: junk, heading corroboration, and a tf floor that
  // relaxes fully at the last tier — a starved row shows its once-mentioned
  // vocabulary rather than nothing.
  const passesJunkGates = (term: string, s: TermStats, tier: number) => {
    if (term.split(" ").some((w) => excluded.has(w))) return false;
    if (isJunkTerm(term, ctx.idBlocklist, ctx.vaultStats)) return false;
    if (!s.nonHeading && (headingLines.get(term) || 0) < 2) return false;
    const minTf = tier >= 2 ? 1 : s.titleDf > 0 || term.includes(" ") ? 2 : 3;
    return s.tf >= minTf;
  };

  // Core statistical priors. The df-floor exception requires a roster entry
  // (a full note title) — frontmatter values ("status: proceed") and
  // fragments of longer titles must not carry a once-seen word past the
  // floor. Vault-common terms cannot discriminate any domain — measured
  // outside the folder, so a dominant folder (80% of the vault) is not
  // banned from its own recurring vocabulary; the absolute floor keeps the
  // ratio meaningful in tiny vaults.
  const passesTier1Priors = (term: string, s: TermStats, tier: number) => {
    if (s.df < minDf && !data.rosterTitles.has(term)) return false;
    if (
      term.includes(" ") &&
      s.df < Math.min(2, notes) &&
      !data.rosterTitles.has(term)
    ) {
      return false;
    }
    const commonRatio =
      tier >= 1 ? VAULT_COMMON_RATIO_RELAXED : VAULT_COMMON_RATIO;
    const outsideDf = (ctx.vaultStats.get(term)?.df ?? 0) - s.df;
    const outsideNotes = ctx.vaultNotes - notes;
    return outsideDf <= Math.max(tier >= 1 ? 4 : 3, commonRatio * outsideNotes);
  };

  // Strict quality priors: non-domain words, template boilerplate (present
  // in most notes of a big folder but only ~once per note — real recurring
  // entities repeat within notes), and shared writing style in big
  // heterogeneous folders (a keyword must be a title word somewhere or a
  // bursty topic; "silently" is neither).
  const passesTier0Priors = (term: string, s: TermStats) => {
    if (
      term
        .split(" ")
        .some((w) => isNonDomainWord(ctx, w, stats, folderShare, rosterWords))
    ) {
      return false;
    }
    if (notes >= 10 && s.df / notes > 0.6 && s.tf / s.df < 2.5) return false;
    return !(notes >= 12 && s.titleDf === 0 && s.tf / s.df < 2.5);
  };

  const passesFilters = (term: string, s: TermStats, tier: number): boolean => {
    if (!passesJunkGates(term, s, tier)) return false;
    if (tier >= 2) return true;
    if (!passesTier1Priors(term, s, tier)) return false;
    if (tier >= 1) return true;
    return passesTier0Priors(term, s);
  };

  const scoreTier = (
    tier: number,
    alreadyScored: Set<string>,
  ): ScoredCandidate[] => {
    const prelim = [...stats.entries()]
      .filter(
        ([term, s]) => !alreadyScored.has(term) && passesFilters(term, s, tier),
      )
      .map(([term, s]) => {
        const v = ctx.vaultStats.get(term);
        const conc = v ? Math.min(1, s.tf / v.tf) : 1;
        const titleBoost =
          1 +
          Math.min(
            2,
            (s.titleDf > 0 ? 1 : 0) + s.titleDf / Math.max(1, notes * 0.2),
          );
        // Burstiness separates topic words (heavy use in the notes that have
        // them: "payroll") from genre words spread thin ("silently", "rows").
        const burst = Math.min(3, s.tf / s.df) ** 0.7;
        const salience =
          conc ** 0.3 *
          Math.log(1 + s.tf) *
          burst *
          Math.sqrt(Math.log(1 + s.df)) *
          titleBoost;
        return { term, tf: s.tf, df: s.df, salience };
      });

    applyPhrasePreference(prelim);
    prelim.sort((a, b) => b.salience - a.salience);

    return poolWithRoster(prelim, data.rosterTitles).map(
      ({ term, salience }) => {
        const r = routability(ctx, term, folder, notes, anchor);
        return {
          term,
          ...r,
          salience,
          isRosterTerm: data.rosterTitles.has(term),
        };
      },
    );
  };

  let scored = scoreTier(0, new Set());

  const selected: string[] = [];
  const selectedGains: number[] = [];
  const covered = new Set<string>();
  const used = new Set<number>();
  const usedWords = new Set<string>();
  let firstGain = 0;

  // No count budget: depth is governed by quality. maxKeywords is a manual
  // override cap (≤ 0 means uncapped).
  const budget = ctx.maxKeywords > 0 ? ctx.maxKeywords : Infinity;
  // A row is "starved" below this: relax the next filter tier and refill.
  const minKeywords = Math.min(MIN_KEYWORDS, budget);

  // A candidate conflicts when a descendant row already displays it or a
  // selected term shares a word (incl. plural/near-duplicate variants).
  const conflicts = (term: string): boolean => {
    if (taken.has(term)) return true;
    const words = term.split(" ");
    return (
      words.some((w) => wordVariants(w).some((v) => usedWords.has(v))) ||
      words.some((w) => [...usedWords].some((u) => nearDuplicate(w, u)))
    );
  };

  // Best remaining candidate by salience × coverage-diversity × routability.
  // Coverage is a soft preference, never a veto: probes see only the top-10,
  // so a genuine domain term can re-hit covered notes by accident — and an
  // agent still needs to know the word exists. Routability is a soft bonus,
  // not a veto: agents can scope searches with --path, so the domain's true
  // vocabulary beats routable trivia.
  const bestCandidate = (): { bestIdx: number; bestGain: number } => {
    let bestIdx = -1;
    let bestGain = 0;
    for (let i = 0; i < scored.length; i++) {
      if (used.has(i)) continue;
      const c = scored[i];
      if (conflicts(c.term)) continue;
      const newCovered = c.hits.filter((f) => !covered.has(f)).length;
      const diversity = 0.5 + (0.5 * newCovered) / PROBE_K;
      const gain = c.salience * diversity * (0.35 + c.precision);
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }
    return { bestIdx, bestGain };
  };

  // Quality is the only stop, never depth — an agent must know which search
  // words exist. Two quality readings: the vault-wide bar (median row-best
  // gain, scaled) and a relative floor against the row's k-th best gain
  // (outlier-robust), which catches rows whose weak tail still clears a low
  // vault bar. Neither starves a row below its minimum representation.
  const stopBar = (): number => {
    if (selected.length < minKeywords) return 0.02;
    const ref = selectedGains[minKeywords - 1];
    return Math.max(0.02, qualityBar, ref * RELATIVE_STOP_RATIO);
  };

  const greedyFill = () => {
    while (selected.length < budget) {
      const { bestIdx, bestGain } = bestCandidate();
      if (bestIdx === -1 || bestGain < stopBar()) break;
      if (firstGain === 0) firstGain = bestGain;
      used.add(bestIdx);
      selected.push(scored[bestIdx].term);
      selectedGains.push(bestGain);
      for (const w of scored[bestIdx].term.split(" ")) usedWords.add(w);
      for (const f of scored[bestIdx].hits) covered.add(f);
    }
  };

  // Roster completion: a term that is the full title of a real note is a
  // curated handle by definition, exempt from the gain bar that governs
  // derived vocabulary. One-note-per-entity folders list their entities
  // even when a few strong topic terms dominate the gains.
  const completeRoster = () => {
    for (let i = 0; i < scored.length && selected.length < budget; i++) {
      if (used.has(i) || !scored[i].isRosterTerm) continue;
      const c = scored[i];
      if (conflicts(c.term)) continue;
      used.add(i);
      selected.push(c.term);
      for (const w of c.term.split(" ")) usedWords.add(w);
    }
  };

  greedyFill();
  for (let tier = 1; tier <= 2 && selected.length < minKeywords; tier++) {
    const have = new Set(scored.map((c) => c.term));
    scored = scored.concat(scoreTier(tier, have));
    greedyFill();
  }
  completeRoster();

  return { keywords: selected, firstGain };
}

// ─── Topic decomposition ────────────────────────────────────────────

interface TopicHead {
  label: string;
  m: Set<number>;
}

interface TopicDraft {
  label: string;
  m: Set<number>;
  terms: string[];
}

/** Notes strongly containing the term (title mention or body tf >= 2). */
function topicMembers(strongTerms: Set<string>[], term: string): Set<number> {
  const m = new Set<number>();
  for (let i = 0; i < strongTerms.length; i++) {
    if (strongTerms[i].has(term)) m.add(i);
  }
  return m;
}

/**
 * Head candidates: phrases people actually title notes with (curated
 * evidence), junk-gated, with the strong-share ubiquity ban keeping operator
 * and company names out.
 */
function gatherTopicHeads(
  ctx: SelectionContext,
  folder: string,
  data: FolderData,
  minNotes: number,
): TopicHead[] {
  const { strongTerms, stats } = data;
  const n = strongTerms.length;
  const excluded = folderPathTokens(folder);
  const outsideNotes = ctx.vaultNotes - data.noteCount;

  const heads: TopicHead[] = [];
  for (const [term, s] of stats) {
    if (s.nameDf < Math.max(2, Math.round(TOPIC_MIN_SHARE * n))) continue;
    const words = term.split(" ");
    if (words.some((w) => excluded.has(w) || GENERIC_SEGMENTS.has(w))) continue;
    if (isJunkTerm(term, ctx.idBlocklist, ctx.vaultStats)) continue;
    const m = topicMembers(strongTerms, term);
    if (m.size < minNotes) continue;
    if (outsideNotes > 30 && isUbiquitousTerm(ctx, term)) continue;
    // A topic that swallows most of the row is the folder's genre, not a
    // subtopic — measured on strong membership, so a domain giant discussed
    // in passing everywhere (a vault's core product line) still qualifies.
    if (m.size > TOPIC_MAX_SHARE * n) continue;
    heads.push({ label: term, m });
  }
  return heads;
}

/** Strong in most folders (median share) — operator or company furniture. */
function isUbiquitousTerm(ctx: SelectionContext, term: string): boolean {
  const shares = ctx.strongShares(term);
  const median = shares[Math.floor(shares.length / 2)] ?? 0;
  return median >= TOPIC_UBIQUITY_MEDIAN;
}

/**
 * Greedy set cover: each topic must explain notes no earlier topic covers.
 * The longest phrase naming mostly the same notes is the better label
 * ("bakery" -> "night bakery").
 */
function coverTopics(heads: TopicHead[], minNotes: number): TopicDraft[] {
  const covered = new Set<number>();
  const topics: TopicDraft[] = [];
  while (topics.length < MAX_TOPICS) {
    const best = bestUncoveredHead(heads, topics, covered, minNotes);
    if (!best) break;
    const chosen = longestCoLabel(heads, best);
    topics.push({ label: chosen.label, m: chosen.m, terms: [] });
    for (const i of chosen.m) covered.add(i);
  }
  return topics;
}

/** The head explaining the most not-yet-covered notes (phrases favored). */
function bestUncoveredHead(
  heads: TopicHead[],
  topics: TopicDraft[],
  covered: Set<number>,
  minNotes: number,
): TopicHead | null {
  let best: TopicHead | null = null;
  let bestGain = 0;
  for (const h of heads) {
    if (topics.some((t) => t.label === h.label)) continue;
    let news = 0;
    for (const i of h.m) if (!covered.has(i)) news++;
    const gain = news * (1 + 0.3 * (h.label.split(" ").length - 1));
    if (news >= minNotes && gain > bestGain) {
      bestGain = gain;
      best = h;
    }
  }
  return best;
}

/** The longest phrase naming mostly the same notes wins the label. */
function longestCoLabel(heads: TopicHead[], chosen: TopicHead): TopicHead {
  let label = chosen;
  for (const h of heads) {
    if (
      h.label.split(" ").length > label.label.split(" ").length &&
      h.label.includes(label.label)
    ) {
      let inter = 0;
      for (const i of h.m) if (label.m.has(i)) inter++;
      if (inter >= 0.7 * label.m.size) label = h;
    }
  }
  return label;
}

/**
 * Keywords whose notes live inside a topic become its terms; the rest stay
 * as the row's cross-topic vocabulary.
 */
function assignKeywordsToTopics(
  topics: TopicDraft[],
  keywords: string[],
  strongTerms: Set<string>[],
): string[] {
  const leftover: string[] = [];
  for (const k of keywords) {
    if (topics.some((t) => t.label === k || t.label.includes(k))) continue;
    const home = containingTopic(topics, topicMembers(strongTerms, k));
    if (home && home.terms.length < MAX_TOPIC_TERMS) home.terms.push(k);
    else leftover.push(k);
  }
  return leftover;
}

/** The topic containing most of the members, above the containment bar. */
function containingTopic(
  topics: TopicDraft[],
  m: Set<number>,
): TopicDraft | null {
  let home: TopicDraft | null = null;
  let bestContainment = TOPIC_TERM_CONTAINMENT;
  for (const t of topics) {
    let inter = 0;
    for (const i of m) if (t.m.has(i)) inter++;
    const containment = m.size > 0 ? inter / m.size : 0;
    if (containment > bestContainment) {
      bestContainment = containment;
      home = t;
    }
  }
  return home;
}

/**
 * Decompose a multi-topic folder into name-backed topics with
 * content-grounded membership: a note belongs to a topic it mentions in its
 * title or discusses in its body (tf >= 2).
 */
function selectTopics(
  ctx: SelectionContext,
  folder: string,
  data: FolderData,
  keywords: string[],
): { topics: OverviewTopic[]; leftover: string[] } | undefined {
  const n = data.strongTerms.length;
  if (n < 8) return undefined;
  const minNotes = Math.max(TOPIC_MIN_NOTES, Math.round(TOPIC_MIN_SHARE * n));

  const heads = gatherTopicHeads(ctx, folder, data, minNotes);
  const topics = coverTopics(heads, minNotes);
  if (topics.length < 2) return undefined;
  const leftover = assignKeywordsToTopics(topics, keywords, data.strongTerms);

  topics.sort((a, b) => b.m.size - a.m.size);
  return {
    topics: topics.map((t) => ({
      label: t.label,
      notes: t.m.size,
      terms: t.terms,
    })),
    leftover,
  };
}

// ─── Assembly ────────────────────────────────────────────────────────

interface VaultData {
  folderData: Map<string, FolderData>;
  vaultStats: Map<string, TermStats>;
  vaultNotes: number;
  idBlocklist: Set<string>;
  capTf: Map<string, number>;
  headingTermCache: Map<string, Map<string, number>>;
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
  const capTf = new Map<string, number>();
  const headingTermCache = new Map<string, Map<string, number>>();
  const vaultStats = new Map<string, TermStats>();
  let vaultNotes = 0;

  const folderData = new Map<string, FolderData>();
  for (const [folder, folderFileList] of folderFiles) {
    const depth = folder === "/" ? 0 : folder.split("/").length;
    if (depth > maxDepth) continue;

    const notes: NoteData[] = [];
    for (const file of folderFileList) {
      const content = fs.readFileSync(path.join(contentPath, file), "utf-8");
      const note = buildNoteData(
        file,
        content,
        idBlocklist,
        capTf,
        headingTermCache,
        warnings,
      );
      if (note) notes.push(note);
    }

    const data = buildFolderData(notes, headingTermCache);
    // A malformed note is skipped for keywords/tags but still counted.
    data.noteCount = folderFileList.length;
    folderData.set(folder, data);

    for (const [term, s] of data.stats) addTermStats(vaultStats, term, s);
    vaultNotes += folderFileList.length;
  }

  return {
    folderData,
    vaultStats,
    vaultNotes,
    idBlocklist,
    capTf,
    headingTermCache,
    warnings,
  };
}

/** Terms already displayed on descendant rows — a parent must add new info. */
function claimedByDescendants(
  keywordsByFolder: Map<string, string[]>,
  folder: string,
): Set<string> {
  const taken = new Set<string>();
  for (const [other, terms] of keywordsByFolder) {
    const isDescendant = folder === "/" ? true : other.startsWith(`${folder}/`);
    if (isDescendant) for (const t of terms) taken.add(t);
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
  const { vaultStats, vaultNotes, idBlocklist, capTf, headingTermCache } =
    vault;
  const { warnings } = vault;
  let { folderData } = vault;

  let collapsedCounts = new Map<string, CollapseRecord>();
  if (collapse) {
    const result = collapseHomogeneousSiblings(folderData);
    folderData = result.data;
    collapsedCounts = result.collapsed;
  }

  if (folderData.size === 0) return { folders: [], warnings };

  // Strong-membership share per sizeable folder, for the topic ubiquity
  // test — computed over final (post-collapse) folder data, cached per term.
  const sizeableFolders = [...folderData.values()].filter(
    (d) => d.strongTerms.length >= 8,
  );
  const shareCache = new Map<string, number[]>();
  const strongShares = (term: string): number[] => {
    const hit = shareCache.get(term);
    if (hit) return hit;
    const shares = sizeableFolders
      .map((d) => {
        let count = 0;
        for (const strong of d.strongTerms) if (strong.has(term)) count++;
        return count / d.strongTerms.length;
      })
      .sort((a, b) => b - a);
    shareCache.set(term, shares);
    return shares;
  };

  const ctx: SelectionContext = {
    corpus: loadSearchCorpus(contentPath, configPath),
    probeCache: new Map(),
    vaultStats,
    vaultNotes,
    idBlocklist,
    capTf,
    headingTermCache,
    maxKeywords,
    strongShares,
  };

  // Children select first (deepest paths), claiming their terms; ancestor
  // rows must then contribute information not already visible on a
  // descendant row.
  const byDepthDesc = [...folderData.keys()].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );
  const selectKeywordsForRows = (
    qualityBar: number,
  ): { keywordsByFolder: Map<string, string[]>; firstGains: number[] } => {
    const keywordsByFolder = new Map<string, string[]>();
    const firstGains: number[] = [];
    for (const folder of byDepthDesc) {
      const data = folderData.get(folder);
      if (!data) continue;
      const taken = claimedByDescendants(keywordsByFolder, folder);
      const { keywords, firstGain } = selectKeywords(
        ctx,
        folder,
        data,
        taken,
        qualityBar,
      );
      keywordsByFolder.set(folder, keywords);
      firstGains.push(firstGain);
    }
    return { keywordsByFolder, firstGains };
  };

  // Pass 1 measures each row's best marginal gain; the median calibrates a
  // vault-wide quality bar ("good" is an absolute notion, not relative to
  // the row's own best). Pass 2 selects against it — probe caches stay hot,
  // so the rerun is cheap.
  const gains = selectKeywordsForRows(0)
    .firstGains.filter((g) => g > 0)
    .sort((a, b) => a - b);
  const median = gains.length > 0 ? gains[Math.floor(gains.length / 2)] : 0;
  const { keywordsByFolder } = selectKeywordsForRows(
    median * QUALITY_BAR_RATIO,
  );

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
    const keywords = keywordsByFolder.get(folder) ?? [];
    const decomposed = selectTopics(ctx, folder, data, keywords);
    folders.push({
      path: folder,
      notes: data.noteCount,
      keywords: decomposed ? decomposed.leftover : keywords,
      tags: [...data.tags].sort(),
      ...(decomposed ? { topics: decomposed.topics } : {}),
      ...(about ? { about } : {}),
      ...(record ? { collapsedFolders: record.count, contains } : {}),
    });
  }

  return { folders, warnings };
}

export function getOverview(
  contentPath: string,
  configPath: string,
  opts?: { depth?: number; keywords?: number; collapse?: boolean },
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
  const optionsKey = `v5|${maxDepth}|${maxKeywords}|${collapse}|${config.templates.folder}`;
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
