import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../utils/config.js";
import { listFiles } from "../utils/files.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { extractHeadings, extractTags } from "../utils/markdown.js";

export interface OverviewFolder {
  path: string;
  notes: number;
  keywords: string[];
  tags: string[];
  /** Number of subfolders rolled up into this row (homogeneous-sibling collapse). */
  collapsedFolders?: number;
}

export interface VaultOverview {
  context?: string;
  overview: OverviewFolder[];
  warnings?: string[];
}

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const URL_RE = /https?:\/\/[^\s)>\]]+/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const HEX_HASH_RE = /\b[a-f0-9]{8,}\b/g;
// Structured noise from imported/converted documents (OCR'd PDFs, DocuSign
// exports, HTML conversions). Stripped before tokenization so ID shrapnel
// ("DAB4-BCF3-..." → "dab", "bcf") never reaches keyword scoring.
const DASHED_HEX_RE = /\b[0-9a-f]{2,}(?:-[0-9a-f]{2,})+\b/gi;
const DIGIT_BLOB_RE = /\b(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{6,}\b/gi;
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;
const HTML_ENTITY_RE = /&[a-z]+;|&#\d+;/gi;
const HEXLETTER_RUN_RE = /\b[a-f]{7,}\b/gi;

// Homogeneous-sibling collapse: parents with at least this many children
// whose term distributions are at least this similar (mean pairwise cosine
// over top terms) are rendered as a single aggregate row. Tuned against a
// corpus of real-world agent vaults — imported document dumps sit at ~0.15–0.25
// similarity, curated folder structures below ~0.05.
const COLLAPSE_MIN_CHILDREN = 5;
const COLLAPSE_SIMILARITY = 0.15;
const COLLAPSE_COSINE_TOP_TERMS = 60;
const COLLAPSE_PAIRWISE_CAP = 20;
const TOKEN_RE = /[a-z]{3,}/g;
const FRONTMATTER_RE = /^---[\s\S]*?---\n?/;
const ATX_HEADING_LINE_RE = /^#{1,6}\s+.+$/gm;
const WIKILINK_ONLY_RE = /^\[\[[^\]]+(?:\|[^\]]+)?\]\]$/;
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "as",
  "be",
  "was",
  "are",
  "this",
  "that",
  "not",
  "has",
  "have",
  "had",
  "will",
  "can",
  "may",
  "do",
  "does",
  "did",
  "been",
  "being",
  "would",
  "could",
  "should",
  "its",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "we",
  "they",
  "you",
  "he",
  "she",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "just",
  "about",
  "above",
  "after",
  "again",
  "also",
  "any",
  "because",
  "before",
  "between",
  "down",
  "during",
  "even",
  "first",
  "get",
  "how",
  "if",
  "into",
  "like",
  "made",
  "make",
  "many",
  "much",
  "new",
  "no",
  "now",
  "off",
  "old",
  "only",
  "one",
  "out",
  "over",
  "own",
  "same",
  "so",
  "still",
  "then",
  "there",
  "these",
  "those",
  "through",
  "under",
  "up",
  "use",
  "used",
  "using",
  "want",
  "way",
  "well",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "work",
  "see",
  "here",
  "need",
  "etc",
  "two",
  "next",
  "per",
  "via",
  "vs",
  "yet",
  "ago",
  "due",
  "tbd",
]); // prettier-ignore

interface WeightedText {
  text: string;
  weight: number;
}

interface HeadingSignals {
  lineCount: Map<string, number>;
  weightedTerms: Map<string, number>;
}

interface FolderData {
  tf: Map<string, number>;
  /**
   * Term frequencies from note content (bodies and heading lines, unweighted;
   * no filename or title terms). Used for sibling-collapse similarity so
   * shared naming conventions cannot fake content homogeneity.
   */
  bodyTF: Map<string, number>;
  headingLineCount: Map<string, number>;
  hasNonHeading: Set<string>;
  tags: Set<string>;
  noteCount: number;
}

function stripNoise(text: string): string {
  return text
    .replace(CODE_BLOCK_RE, "")
    .replace(INLINE_CODE_RE, "")
    .replace(URL_RE, "")
    .replace(EMAIL_RE, "")
    .replace(HTML_TAG_RE, " ")
    .replace(HTML_ENTITY_RE, " ")
    .replace(DASHED_HEX_RE, " ")
    .replace(DIGIT_BLOB_RE, " ")
    .replace(HEXLETTER_RUN_RE, " ")
    .replace(HEX_HASH_RE, "");
}

function tokenize(text: string): string[] {
  const cleaned = stripNoise(text);
  return (cleaned.toLowerCase().match(TOKEN_RE) || []).filter(
    (w) => !STOP_WORDS.has(w),
  );
}

function extractBigrams(text: string): string[] {
  const words = tokenize(text);
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

function terms(text: string): string[] {
  return [...tokenize(text), ...extractBigrams(text)];
}

function addWeightedTerms(
  target: Map<string, number>,
  sourceTerms: Iterable<string>,
  weight: number,
): void {
  for (const term of sourceTerms) {
    target.set(term, (target.get(term) || 0) + weight);
  }
}

function buildTF(sources: WeightedText[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const { text, weight } of sources) {
    addWeightedTerms(freq, terms(text), weight);
  }
  return freq;
}

function folderKeywordTokens(folderPath: string): Set<string> {
  const tokens = new Set<string>();
  for (const segment of folderPath.split("/")) {
    for (const token of tokenize(segment)) {
      tokens.add(token);
      tokens.add(token.endsWith("s") ? token.slice(0, -1) : `${token}s`);
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

function buildHeadingSignals(headings: Iterable<string>): HeadingSignals {
  const lineCount = new Map<string, number>();
  const weightedTerms = new Map<string, number>();
  const uniqueTerms = new Set<string>();

  for (const heading of headings) {
    const seenInHeading = new Set(terms(heading));
    for (const term of seenInHeading) {
      uniqueTerms.add(term);
      lineCount.set(term, (lineCount.get(term) || 0) + 1);
    }
  }

  addWeightedTerms(weightedTerms, uniqueTerms, 3);
  return { lineCount, weightedTerms };
}

function isCandidateKeyword(
  term: string,
  tf: number,
  folderTokens: Set<string>,
  headingLineCount: Map<string, number>,
  hasNonHeading: Set<string>,
): boolean {
  if (term.includes(" ")) {
    const [a, b] = term.split(" ");
    if (tf < 2 || a === b) return false;
  } else if (folderTokens.has(term)) {
    return false;
  }

  // Require corroboration: real keywords either appear outside headings or in
  // multiple heading lines. Single heading-only terms are usually section labels.
  return hasNonHeading.has(term) || (headingLineCount.get(term) || 0) >= 2;
}

function extractKeywordsTFIDF(
  folderTF: Map<string, number>,
  documentFrequency: Map<string, number>,
  totalFolders: number,
  maxKeywords: number,
  folderPath: string,
  headingLineCount: Map<string, number>,
  hasNonHeading: Set<string>,
): string[] {
  const folderTokens = folderKeywordTokens(folderPath);
  const scored: [string, number][] = [];

  for (const [term, tf] of folderTF) {
    if (
      !isCandidateKeyword(
        term,
        tf,
        folderTokens,
        headingLineCount,
        hasNonHeading,
      )
    ) {
      continue;
    }

    const df = documentFrequency.get(term) || 1;
    const idf = Math.log(1 + totalFolders / df);
    scored.push([term, tf * idf]);
  }

  const sorted = scored.sort((a, b) => b[1] - a[1]);
  const selected: string[] = [];
  const suppressed = new Set<string>();

  for (const [term] of sorted) {
    if (selected.length >= maxKeywords) break;
    if (suppressed.has(term)) continue;

    selected.push(term);
    if (term.includes(" ")) {
      for (const part of term.split(" ")) {
        suppressed.add(part);
      }
    }
  }

  return selected;
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
  const tf = new Map<string, number>();
  const bodyTF = new Map<string, number>();
  const headingLineCount = new Map<string, number>();
  const hasNonHeading = new Set<string>();
  const tags = new Set<string>();
  let noteCount = 0;
  for (const d of items) {
    for (const [k, v] of d.tf) tf.set(k, (tf.get(k) || 0) + v);
    for (const [k, v] of d.bodyTF) bodyTF.set(k, (bodyTF.get(k) || 0) + v);
    for (const [k, v] of d.headingLineCount) {
      headingLineCount.set(k, (headingLineCount.get(k) || 0) + v);
    }
    for (const k of d.hasNonHeading) hasNonHeading.add(k);
    for (const t of d.tags) tags.add(t);
    noteCount += d.noteCount;
  }
  return { tf, bodyTF, headingLineCount, hasNonHeading, tags, noteCount };
}

/**
 * Collapse numerous, lexically homogeneous sibling folders into their parent
 * so repetitive subtrees (imported document dumps, per-entity folder fans)
 * render as one aggregate row instead of dominating the overview. The vault
 * root is never a collapse target: top-level folders are the taxonomy.
 */
function collapseHomogeneousSiblings(folderData: Map<string, FolderData>): {
  data: Map<string, FolderData>;
  collapsed: Map<string, number>;
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
  const collapsed = new Map<string, number>();

  for (const parent of parents) {
    if (parent === "/") continue;
    const children = (byParent.get(parent) || []).filter((c) => data.has(c));
    if (children.length < COLLAPSE_MIN_CHILDREN) continue;

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
    if (pairs === 0 || sum / pairs < COLLAPSE_SIMILARITY) continue;

    const toMerge: FolderData[] = [];
    let mergedFolderCount = 0;
    for (const child of children) {
      const d = data.get(child);
      if (!d) continue;
      toMerge.push(d);
      mergedFolderCount += 1 + (collapsed.get(child) || 0);
      data.delete(child);
      collapsed.delete(child);
    }
    const existing = data.get(parent);
    const merged = existing
      ? mergeFolderData([existing, ...toMerge])
      : mergeFolderData(toMerge);
    data.set(parent, merged);
    collapsed.set(parent, (collapsed.get(parent) || 0) + mergedFolderCount);
  }

  return { data, collapsed };
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

function buildFolderData(
  vaultPath: string,
  folderFileList: string[],
  warnings: string[],
): FolderData {
  const allTags = new Set<string>();
  const headings = new Set<string>();
  const weightedSources: WeightedText[] = [];
  const bodyTF = new Map<string, number>();

  for (const file of folderFileList) {
    const content = fs.readFileSync(path.join(vaultPath, file), "utf-8");
    let properties: Record<string, unknown> = {};

    try {
      ({ properties } = parseFrontmatter(content));
    } catch {
      warnings.push(`Skipping ${file} (malformed YAML frontmatter)`);
      continue;
    }

    for (const tag of extractTags(content)) allTags.add(tag);
    if (Array.isArray(properties.tags)) {
      for (const tag of properties.tags) allTags.add(String(tag));
    }

    const fileHeadings = extractHeadings(content);
    for (const heading of fileHeadings) {
      headings.add(heading.text.trim());
      addWeightedTerms(bodyTF, terms(heading.text), 1);
    }

    weightedSources.push({ text: path.basename(file, ".md"), weight: 2 });
    if (properties.title) {
      weightedSources.push({ text: String(properties.title), weight: 2 });
    }
    for (const value of frontmatterText(properties)) {
      weightedSources.push({ text: value, weight: 2 });
    }
    const body = markdownBodyText(content);
    weightedSources.push({ text: body, weight: 1 });
    addWeightedTerms(bodyTF, terms(body), 1);
  }

  const tf = buildTF(weightedSources);
  const hasNonHeading = new Set(tf.keys());
  const headingSignals = buildHeadingSignals(headings);

  for (const [term, weight] of headingSignals.weightedTerms) {
    tf.set(term, (tf.get(term) || 0) + weight);
  }

  return {
    tf,
    bodyTF,
    headingLineCount: headingSignals.lineCount,
    hasNonHeading,
    tags: allTags,
    noteCount: folderFileList.length,
  };
}

function buildOverviewFolders(
  vaultPath: string,
  maxDepth: number,
  maxKeywords: number,
  templatesFolder: string,
  collapse: boolean,
): { folders: OverviewFolder[]; warnings: string[] } {
  const files = listFiles(vaultPath, { ext: "md" });
  const warnings: string[] = [];
  const folderFiles = groupFilesByFolder(files, templatesFolder);
  let folderData = new Map<string, FolderData>();

  for (const [folder, folderFileList] of folderFiles) {
    const depth = folder === "/" ? 0 : folder.split("/").length;
    if (depth > maxDepth) continue;

    folderData.set(
      folder,
      buildFolderData(vaultPath, folderFileList, warnings),
    );
  }

  let collapsedCounts = new Map<string, number>();
  if (collapse) {
    const result = collapseHomogeneousSiblings(folderData);
    folderData = result.data;
    collapsedCounts = result.collapsed;
  }

  const documentFrequency = new Map<string, number>();
  for (const { tf } of folderData.values()) {
    for (const term of tf.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const totalFolders = folderData.size;
  const folders: OverviewFolder[] = [];

  for (const [folder, data] of [...folderData.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    folders.push({
      path: folder,
      notes: data.noteCount,
      keywords: extractKeywordsTFIDF(
        data.tf,
        documentFrequency,
        totalFolders,
        maxKeywords,
        folder,
        data.headingLineCount,
        data.hasNonHeading,
      ),
      tags: [...data.tags].sort(),
      ...(collapsedCounts.has(folder)
        ? { collapsedFolders: collapsedCounts.get(folder) }
        : {}),
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

  const { folders, warnings } = buildOverviewFolders(
    contentPath,
    maxDepth,
    maxKeywords,
    config.templates.folder,
    collapse,
  );

  const contextPath = path.join(contentPath, "NAPKIN.md");
  const context = fs.existsSync(contextPath)
    ? fs.readFileSync(contextPath, "utf-8").trim()
    : undefined;

  return {
    ...(context ? { context } : {}),
    overview: folders,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
