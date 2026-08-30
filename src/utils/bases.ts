import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import initSqlJs, { type Database } from "sql.js";
import { listFiles } from "./files.js";
import {
  createFormulaEngine,
  evaluateFormulas,
  parseDurationMs,
  startOfDayMs,
} from "./formula.js";
import { parseFrontmatter } from "./frontmatter.js";
import { extractLinks, extractTags } from "./markdown.js";

export interface BaseView {
  type: string;
  name?: string;
  limit?: number;
  filters?: unknown;
  order?: string[];
  groupBy?: { property: string; direction?: string };
  summaries?: Record<string, string>;
}

export interface BaseConfig {
  filters?: unknown;
  formulas?: Record<string, string>;
  properties?: Record<string, { displayName?: string }>;
  summaries?: Record<string, string>;
  views?: BaseView[];
}

/**
 * Parse a .base YAML file. Bases are YAML format.
 */
export function parseBaseFile(content: string): BaseConfig {
  return yaml.load(content) as BaseConfig;
}

interface BaseFileRow {
  path: string;
  name: string;
  basename: string;
  folder: string;
  ext: string;
  size: number;
  ctime: number;
  mtime: number;
  tags: string;
  links: string;
  properties: Record<string, unknown>;
}

/** First pass: read every note, collecting rows and all property names. */
function collectFileRows(vaultPath: string): {
  fileData: BaseFileRow[];
  allProps: Set<string>;
} {
  const allProps = new Set<string>();
  const fileData: BaseFileRow[] = [];

  for (const file of listFiles(vaultPath, { ext: "md" })) {
    const fullPath = path.join(vaultPath, file);
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, "utf-8");
    const { properties } = parseFrontmatter(content);
    const tags = extractTags(content);
    const linkInfo = extractLinks(content);

    // Also get frontmatter tags
    if (Array.isArray(properties.tags)) {
      for (const t of properties.tags) tags.push(String(t));
    }

    for (const key of Object.keys(properties)) {
      if (key !== "tags") allProps.add(key);
    }

    fileData.push({
      path: file,
      name: path.basename(file),
      basename: path.basename(file, path.extname(file)),
      folder: path.dirname(file),
      ext: path.extname(file).slice(1),
      size: stat.size,
      ctime: stat.birthtimeMs,
      mtime: stat.mtimeMs,
      tags: JSON.stringify([...new Set(tags)]),
      links: JSON.stringify(linkInfo.wikilinks),
      properties,
    });
  }

  return { fileData, allProps };
}

/** For each file, which other files link to it (basename match, like wikilinks). */
function computeBaseBacklinks(fileData: BaseFileRow[]): Map<string, string[]> {
  const backlinkMap = new Map<string, string[]>();
  for (const f of fileData) {
    backlinkMap.set(f.path, []);
  }
  for (const f of fileData) {
    const links: string[] = JSON.parse(f.links);
    for (const link of links) {
      const linkLower = link.toLowerCase();
      for (const target of fileData) {
        if (
          target.basename.toLowerCase() === linkLower ||
          target.name.toLowerCase() === linkLower ||
          target.name.toLowerCase() === `${linkLower}.md`
        ) {
          const bl = backlinkMap.get(target.path) || [];
          bl.push(f.basename);
          backlinkMap.set(target.path, bl);
        }
      }
    }
  }
  return backlinkMap;
}

const EMBED_RE = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function extractEmbeds(content: string): string[] {
  const embeds: string[] = [];
  for (const m of content.matchAll(EMBED_RE)) {
    embeds.push(m[1]);
  }
  return embeds;
}

/**
 * Build an in-memory SQLite database from vault files.
 * Creates a `files` table with columns for file metadata and all frontmatter properties.
 */
export async function buildDatabase(vaultPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const { fileData, allProps } = collectFileRows(vaultPath);

  // Create table with file columns + property columns
  const propCols = [...allProps].map((p) => `"prop_${p}" TEXT`).join(", ");
  const createSQL = `CREATE TABLE files (
    path TEXT PRIMARY KEY,
    name TEXT,
    basename TEXT,
    folder TEXT,
    ext TEXT,
    size INTEGER,
    ctime REAL,
    mtime REAL,
    tags TEXT,
    links TEXT,
    backlinks TEXT,
    embeds TEXT,
    file_properties TEXT
    ${propCols ? `, ${propCols}` : ""}
  )`;
  db.run(createSQL);

  // Register REGEXP function for regex filter support
  db.create_function("REGEXP", (pattern: string, value: string) => {
    try {
      return new RegExp(pattern).test(value ?? "") ? 1 : 0;
    } catch {
      return 0;
    }
  });

  const backlinkMap = computeBaseBacklinks(fileData);

  const propNames = [...allProps];
  // 13 base columns + N prop columns
  const placeholders = [
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    ...propNames.map(() => "?"),
  ].join(", ");
  const insertSQL = `INSERT INTO files VALUES (${placeholders})`;

  for (const f of fileData) {
    const propValues = propNames.map((p) => {
      const v = f.properties[p];
      if (v === undefined || v === null) return null;
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    });

    const backlinks = JSON.stringify(backlinkMap.get(f.path) || []);

    const fullPath = path.join(vaultPath, f.path);
    const embeds = extractEmbeds(fs.readFileSync(fullPath, "utf-8"));
    const fileProps = JSON.stringify(f.properties);

    db.run(insertSQL, [
      f.path,
      f.name,
      f.basename,
      f.folder,
      f.ext,
      f.size,
      f.ctime,
      f.mtime,
      f.tags,
      f.links,
      backlinks,
      JSON.stringify(embeds),
      fileProps,
      ...propValues,
    ]);
  }

  return db;
}

/**
 * Translate a Bases filter expression to SQL WHERE clause.
 * Handles the recursive and/or/not structure and simple comparison strings.
 */
export function filterToSQL(
  filter: unknown,
  thisFile?: { name: string; path: string; folder: string },
): string {
  if (!filter) return "1=1";

  if (typeof filter === "string") {
    return translateExpression(filter, thisFile);
  }

  if (typeof filter === "object" && filter !== null) {
    const obj = filter as Record<string, unknown>;

    if (obj.and) {
      const clauses = (obj.and as unknown[]).map((f) =>
        filterToSQL(f, thisFile),
      );
      return `(${clauses.join(" AND ")})`;
    }
    if (obj.or) {
      const clauses = (obj.or as unknown[]).map((f) =>
        filterToSQL(f, thisFile),
      );
      return `(${clauses.join(" OR ")})`;
    }
    if (obj.not) {
      const clauses = (obj.not as unknown[]).map((f) =>
        filterToSQL(f, thisFile),
      );
      return `NOT (${clauses.join(" AND ")})`;
    }
  }

  return "1=1";
}

/**
 * Translate a single filter expression string to SQL.
 * e.g. 'status != "done"' -> "prop_status != 'done'"
 * e.g. 'file.hasTag("book")' -> "tags LIKE '%\"book\"%'"
 */
function translateExpression(
  expr: string,
  thisFile?: { name: string; path: string; folder: string },
): string {
  expr = expr.trim();

  // Replace this.file.* references with literal values
  if (thisFile && expr.includes("this.")) {
    expr = expr
      .replace(/this\.file\.name/g, `"${thisFile.name}"`)
      .replace(/this\.file\.path/g, `"${thisFile.path}"`)
      .replace(/this\.file\.folder/g, `"${thisFile.folder}"`)
      .replace(/this\.file/g, `"${thisFile.path}"`);
  }

  // Handle ! prefix (NOT)
  if (expr.startsWith("!") && !expr.startsWith("!=")) {
    return `NOT (${translateExpression(expr.slice(1).trim(), thisFile)})`;
  }

  // Handle inline && and || (split respecting parentheses)
  const splitByBoolOp = splitOnBooleanOps(expr, thisFile);
  if (splitByBoolOp) {
    return splitByBoolOp;
  }

  return (
    translateFileFn(expr) ??
    translateStringFn(expr) ??
    translateComparison(expr) ??
    // Fallback: treat as a property existence check
    `"prop_${escapeSql(expr)}" IS NOT NULL`
  );
}

/** file.hasTag / file.hasLink / file.inFolder / file.hasProperty. */
function translateFileFn(expr: string): string | null {
  // file.hasTag("tag1", "tag2") -> OR match on tags JSON array
  const hasTagMatch = expr.match(/^file\.hasTag\((.+)\)$/);
  if (hasTagMatch) {
    const args = parseStringArgs(hasTagMatch[1]);
    const clauses = args.map((t) => `tags LIKE '%"${escapeSql(t)}"%'`);
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  }

  const hasLinkMatch = expr.match(/^file\.hasLink\((.+)\)$/);
  if (hasLinkMatch) {
    const args = parseStringArgs(hasLinkMatch[1]);
    const clauses = args.map((l) => `links LIKE '%"${escapeSql(l)}"%'`);
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  }

  const inFolderMatch = expr.match(/^file\.inFolder\("([^"]+)"\)$/);
  if (inFolderMatch) {
    const folder = inFolderMatch[1];
    return `(folder = '${escapeSql(folder)}' OR folder LIKE '${escapeSql(folder)}/%')`;
  }

  const hasPropMatch = expr.match(/^file\.hasProperty\("([^"]+)"\)$/);
  if (hasPropMatch) {
    return `"prop_${escapeSql(hasPropMatch[1])}" IS NOT NULL`;
  }

  return null;
}

/** contains / containsAll / containsAny / startsWith / endsWith / isEmpty / regex. */
function translateStringFn(expr: string): string | null {
  // prop.contains("value") — string LIKE
  const containsMatch = expr.match(/^(.+?)\.contains\((.+)\)$/);
  if (containsMatch && !containsMatch[1].startsWith("file.")) {
    const prop = translateProperty(containsMatch[1].trim());
    const args = parseStringArgs(containsMatch[2]);
    if (args.length === 1) return `${prop} LIKE '%${escapeSql(args[0])}%'`;
  }

  const containsAllMatch = expr.match(/^(.+?)\.containsAll\((.+)\)$/);
  if (containsAllMatch && !containsAllMatch[1].startsWith("file.")) {
    const prop = translateProperty(containsAllMatch[1].trim());
    const args = parseStringArgs(containsAllMatch[2]);
    const clauses = args.map((a) => `${prop} LIKE '%${escapeSql(a)}%'`);
    return `(${clauses.join(" AND ")})`;
  }

  const containsAnyMatch = expr.match(/^(.+?)\.containsAny\((.+)\)$/);
  if (containsAnyMatch && !containsAnyMatch[1].startsWith("file.")) {
    const prop = translateProperty(containsAnyMatch[1].trim());
    const args = parseStringArgs(containsAnyMatch[2]);
    const clauses = args.map((a) => `${prop} LIKE '%${escapeSql(a)}%'`);
    return `(${clauses.join(" OR ")})`;
  }

  const startsWithMatch = expr.match(/^(.+?)\.startsWith\("([^"]+)"\)$/);
  if (startsWithMatch) {
    const prop = translateProperty(startsWithMatch[1].trim());
    return `${prop} LIKE '${escapeSql(startsWithMatch[2])}%'`;
  }

  const endsWithMatch = expr.match(/^(.+?)\.endsWith\("([^"]+)"\)$/);
  if (endsWithMatch) {
    const prop = translateProperty(endsWithMatch[1].trim());
    return `${prop} LIKE '%${escapeSql(endsWithMatch[2])}'`;
  }

  const isEmptyMatch = expr.match(/^(.+?)\.isEmpty\(\)$/);
  if (isEmptyMatch) {
    const prop = translateProperty(isEmptyMatch[1].trim());
    return `(${prop} IS NULL OR ${prop} = '')`;
  }

  // /pattern/.matches(expr) — regex match
  const regexMatch = expr.match(/^\/(.+?)\/\.matches\((.+)\)$/);
  if (regexMatch) {
    const col = translateProperty(regexMatch[2].trim());
    return `${col} REGEXP '${escapeSql(regexMatch[1])}'`;
  }

  return null;
}

/** property op value — e.g. status != "done", price > 2.1, file.ext == "md". */
function translateComparison(expr: string): string | null {
  const cmpMatch = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!cmpMatch) return null;
  const leftRaw = cmpMatch[1].trim();
  const rightRaw = cmpMatch[3].trim();
  // Try resolving both sides as date expressions first
  const leftDate = resolveDateExpr(leftRaw);
  const rightDate = resolveDateExpr(rightRaw);
  const left =
    leftDate !== null ? String(leftDate) : translateProperty(leftRaw);
  const op = cmpMatch[2] === "==" ? "=" : cmpMatch[2];
  const right =
    rightDate !== null ? String(rightDate) : translateValue(rightRaw);
  return `${left} ${op} ${right}`;
}

const boolOpAt = (expr: string, i: number): "AND" | "OR" | null => {
  if (expr[i] === "&" && expr[i + 1] === "&") return "AND";
  if (expr[i] === "|" && expr[i + 1] === "|") return "OR";
  return null;
};

/** Per index: outside strings and parentheses, so operators count. */
function topLevelMask(expr: string): boolean[] {
  const mask: boolean[] = new Array(expr.length);
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      mask[i] = false;
      if (ch === inString && expr[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    mask[i] = depth === 0 && inString === null;
  }
  return mask;
}

/** First top-level && or || outside strings and parentheses, or null. */
function findTopLevelBoolOp(
  expr: string,
): { idx: number; op: "AND" | "OR" } | null {
  const mask = topLevelMask(expr);
  for (let i = 0; i < expr.length; i++) {
    if (!mask[i]) continue;
    const op = boolOpAt(expr, i);
    if (op) return { idx: i, op };
  }
  return null;
}

/**
 * Split an expression on && and || operators, respecting parentheses and quotes.
 * Returns null if no boolean operators found at the top level.
 */
function splitOnBooleanOps(
  expr: string,
  thisFile?: { name: string; path: string; folder: string },
): string | null {
  const found = findTopLevelBoolOp(expr);
  if (!found) return null;
  const left = translateExpression(expr.slice(0, found.idx).trim(), thisFile);
  const right = translateExpression(expr.slice(found.idx + 2).trim(), thisFile);
  return `(${left} ${found.op} ${right})`;
}

function translateProperty(prop: string): string {
  // file.* properties map to columns directly
  if (prop === "file.name") return "name";
  if (prop === "file.basename") return "basename";
  if (prop === "file.path") return "path";
  if (prop === "file.folder") return "folder";
  if (prop === "file.ext") return "ext";
  if (prop === "file.size") return "size";
  if (prop === "file.ctime") return "ctime";
  if (prop === "file.mtime") return "mtime";
  if (prop === "file.backlinks") return "backlinks";
  if (prop === "file.embeds") return "embeds";
  if (prop === "file.properties") return "file_properties";
  if (prop === "file.tags") return "tags";
  if (prop === "file.links") return "links";
  // note.* or bare property names -> prop_ columns
  const name = prop.startsWith("note.") ? prop.slice(5) : prop;
  return `"prop_${escapeSql(name)}"`;
}

function translateValue(val: string): string {
  // Date functions: now(), today(), date("...")
  const dateResolved = resolveDateExpr(val);
  if (dateResolved !== null) return String(dateResolved);

  // Quoted string
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return `'${escapeSql(val.slice(1, -1))}'`;
  }
  // Number
  if (!Number.isNaN(Number(val))) return val;
  // Boolean
  if (val === "true") return "1";
  if (val === "false") return "0";
  // Treat as property reference
  return translateProperty(val);
}

/** now() / today() / date("...") as epoch ms, or null. */
function resolveDateBase(expr: string): number | null {
  if (expr === "now()") return Date.now();
  if (expr === "today()") return startOfDayMs(Date.now());
  const dateMatch = expr.match(/^date\("([^"]+)"\)$/);
  if (dateMatch) {
    const ts = new Date(dateMatch[1]).getTime();
    return Number.isNaN(ts) ? null : ts;
  }
  return null;
}

function resolveDateExpr(expr: string): number | null {
  expr = expr.trim();

  // <base> +/- "duration"
  const arith = expr.match(/^(.+?)\s*([+-])\s*"([^"]+)"$/);
  if (arith) {
    const base = resolveDateBase(arith[1].trim());
    if (base === null) return null;
    const ms = parseDurationMs(arith[3]);
    return arith[2] === "+" ? base + ms : base - ms;
  }

  return resolveDateBase(expr);
}

function parseStringArgs(argsStr: string): string[] {
  const args: string[] = [];
  const regex = /"([^"]+)"|'([^']+)'/g;
  for (let m = regex.exec(argsStr); m !== null; m = regex.exec(argsStr)) {
    args.push(m[1] || m[2]);
  }
  return args;
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Build ORDER BY clause from view config.
 */
export function orderToSQL(order?: string[]): string {
  if (!order || order.length === 0) return "";
  const cols = order.map((o) => translateProperty(o));
  return `ORDER BY ${cols.join(", ")}`;
}

/** Column index for a property, accepting the bare name or note.-prefixed. */
function findColumn(columns: string[], prop: string): number {
  const direct = columns.indexOf(prop);
  if (direct !== -1) return direct;
  return columns.indexOf(prop.startsWith("note.") ? prop.slice(5) : prop);
}

/** Evaluate base formulas per row, appending formula.* columns in place. */
async function appendFormulaColumns(
  columns: string[],
  rows: unknown[][],
  formulas: Record<string, string>,
  thisFile?: { name: string; path: string; folder: string },
): Promise<unknown[][]> {
  const engine = createFormulaEngine();
  const newRows: unknown[][] = [];
  for (const row of rows) {
    const formulaResults = await evaluateFormulas(
      engine,
      formulas,
      columns,
      row,
      thisFile,
    );
    newRows.push([...row, ...Object.values(formulaResults)]);
  }
  columns.push(...Object.keys(formulas).map((k) => `formula.${k}`));
  return newRows;
}

function groupRows(
  view: BaseView | undefined,
  columns: string[],
  rows: unknown[][],
): { key: string; rows: unknown[][] }[] | undefined {
  if (!view?.groupBy) return undefined;
  const groupIdx = findColumn(columns, view.groupBy.property);
  if (groupIdx === -1) return undefined;

  const groupMap = new Map<string, unknown[][]>();
  for (const row of rows) {
    const key = String(row[groupIdx] ?? "(empty)");
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)?.push(row);
  }
  const groups = [...groupMap.entries()].map(([key, rows]) => ({ key, rows }));
  if (view.groupBy.direction === "DESC") groups.reverse();
  return groups;
}

function computeViewSummaries(
  view: BaseView | undefined,
  columns: string[],
  rows: unknown[][],
  baseConfig: BaseConfig,
): Record<string, unknown> | undefined {
  const viewSummaries = view?.summaries as Record<string, string> | undefined;
  if (!viewSummaries) return undefined;
  const summaries: Record<string, unknown> = {};
  for (const [prop, fn] of Object.entries(viewSummaries)) {
    const colIdx = findColumn(columns, prop);
    if (colIdx === -1) continue;
    const values = rows
      .map((r: unknown[]) => r[colIdx])
      .filter((v: unknown) => v !== null && v !== undefined);
    summaries[prop] = computeSummary(fn, values, baseConfig);
  }
  return summaries;
}

function buildDisplayNames(baseConfig: BaseConfig): Record<string, string> {
  const displayNames: Record<string, string> = {};
  for (const [key, config] of Object.entries(baseConfig.properties ?? {})) {
    if (config.displayName) {
      displayNames[key] = config.displayName;
    }
  }
  return displayNames;
}

/**
 * Query the database using a base view config.
 */
export async function queryBase(
  db: Database,
  baseConfig: BaseConfig,
  viewName?: string,
  thisFile?: { name: string; path: string; folder: string },
): Promise<{
  columns: string[];
  rows: unknown[][];
  groups?: { key: string; rows: unknown[][] }[];
  summaries?: Record<string, unknown>;
  displayNames?: Record<string, string>;
}> {
  const view = viewName
    ? baseConfig.views?.find((v) => v.name === viewName)
    : baseConfig.views?.[0];

  // Build WHERE from global filters + view filters
  const globalWhere = filterToSQL(baseConfig.filters, thisFile);
  const viewWhere = view?.filters ? filterToSQL(view.filters, thisFile) : "1=1";
  const where = `(${globalWhere}) AND (${viewWhere})`;

  const orderBy = orderToSQL(view?.order);
  const limit = view?.limit ? `LIMIT ${view.limit}` : "";

  const sql = `SELECT * FROM files WHERE ${where} ${orderBy} ${limit}`;

  try {
    const result = db.exec(sql);
    if (result.length === 0) return { columns: [], rows: [] };

    // Clean up column names (remove prop_ prefix for display)
    const columns = result[0].columns.map((c: string) =>
      c.startsWith("prop_") ? c.slice(5) : c,
    );
    let rows = result[0].values;

    const formulas = baseConfig.formulas;
    if (formulas && Object.keys(formulas).length > 0) {
      rows = await appendFormulaColumns(columns, rows, formulas, thisFile);
    }

    return {
      columns,
      rows,
      groups: groupRows(view, columns, rows),
      summaries: computeViewSummaries(view, columns, rows, baseConfig),
      displayNames: buildDisplayNames(baseConfig),
    };
  } catch (e) {
    throw new Error(`Base query failed: ${(e as Error).message}\nSQL: ${sql}`);
  }
}

/**
 * Compute a summary function over a list of values.
 */
function computeSummary(
  fn: string,
  values: unknown[],
  baseConfig: BaseConfig,
): unknown {
  // Check custom summaries first
  if (
    baseConfig.summaries &&
    fn in (baseConfig.summaries as Record<string, string>)
  ) {
    // Custom summary formula — evaluate with jexl
    // For now, use built-in fallback
  }

  const nums = values.map(Number).filter((n) => !Number.isNaN(n));
  const numeric = NUMERIC_SUMMARIES[fn];
  if (numeric) return numeric(nums);

  const valueBased = VALUE_SUMMARIES[fn];
  if (valueBased) return valueBased(values);

  return null;
}

const median = (nums: number[]): number | null => {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const stddev = (nums: number[]): number | null => {
  if (nums.length === 0) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance =
    nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
};

const NUMERIC_SUMMARIES: Record<string, (nums: number[]) => unknown> = {
  Sum: (nums) => nums.reduce((a, b) => a + b, 0),
  Average: (nums) =>
    nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0,
  Min: (nums) => (nums.length > 0 ? Math.min(...nums) : null),
  Max: (nums) => (nums.length > 0 ? Math.max(...nums) : null),
  Range: (nums) =>
    nums.length > 0 ? Math.max(...nums) - Math.min(...nums) : null,
  Median: median,
  Stddev: stddev,
};

const asDates = (values: unknown[]): number[] =>
  values
    .map((v) => new Date(v as string).getTime())
    .filter((n) => !Number.isNaN(n));

const VALUE_SUMMARIES: Record<string, (values: unknown[]) => unknown> = {
  Earliest: (values) => {
    const dates = asDates(values);
    return dates.length > 0 ? Math.min(...dates) : null;
  },
  Latest: (values) => {
    const dates = asDates(values);
    return dates.length > 0 ? Math.max(...dates) : null;
  },
  Checked: (values) =>
    values.filter((v) => v === "true" || v === true || v === 1 || v === "1")
      .length,
  Unchecked: (values) =>
    values.filter((v) => v === "false" || v === false || v === 0 || v === "0")
      .length,
  Empty: (values) =>
    values.filter((v) => v === null || v === undefined || v === "").length,
  Filled: (values) =>
    values.filter((v) => v !== null && v !== undefined && v !== "").length,
  Unique: (values) => new Set(values.map(String)).size,
};
