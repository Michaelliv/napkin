import Jexl from "jexl";

// All known transforms (methods that Obsidian calls with dot syntax)
const TRANSFORMS = new Set([
  // Any
  "isTruthy",
  "isType",
  "toString",
  // Number
  "abs",
  "ceil",
  "floor",
  "round",
  "toFixed",
  "isEmpty",
  // String
  "contains",
  "containsAll",
  "containsAny",
  "startsWith",
  "endsWith",
  "lower",
  "title",
  "trim",
  "replace",
  "repeat",
  "reverse",
  "slice",
  "split",
  // Date
  "format",
  "date",
  "time",
  "relative",
  // List
  "filter",
  "map",
  "reduce",
  "flat",
  "join",
  "sort",
  "unique",
  // File
  "asLink",
  "hasLink",
  "hasTag",
  "hasProperty",
  "inFolder",
  // Link
  "asFile",
  "linksTo",
  // Object
  "keys",
  "values",
  // Regex
  "matches",
]);

/**
 * Transform Obsidian expression syntax to jexl syntax.
 * Converts .method(args) to |method(args) for known transforms.
 * Also remaps if() to _if() since if is reserved.
 */
export function obsidianToJexl(expr: string): string {
  // Replace if( with _if( — but not inside strings
  let result = expr;

  // Handle if() function calls (not inside quotes)
  result = result.replace(/\bif\s*\(/g, "_if(");

  // Convert .method( to |method( for known transforms
  // Must be careful not to convert property access like file.name
  for (const t of TRANSFORMS) {
    // Match .transform( but not when preceded by a quote (inside string)
    const regex = new RegExp(`\\.${t}\\(`, "g");
    result = result.replace(regex, `|${t}(`);
  }

  // Handle .length (property, not function call) — convert to |_length
  result = result.replace(/\.length\b(?!\s*\()/g, "|_length");

  // Handle .isEmpty() with no args — it's already converted above if it matches
  // Handle .year, .month, .day, .hour, .minute, .second, .millisecond on dates
  for (const field of [
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "millisecond",
    "days",
    "hours",
    "minutes",
    "seconds",
    "milliseconds",
  ]) {
    const regex = new RegExp(`\\.${field}\\b(?!\\s*\\()`, "g");
    result = result.replace(regex, `|_${field}`);
  }

  return result;
}

/**
 * Create a configured jexl instance with all Obsidian Bases functions.
 */
/** Truncate a timestamp to the start of its day, in epoch ms. */
export function startOfDayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function createFormulaEngine(): InstanceType<typeof Jexl.Jexl> {
  const jexl = new Jexl.Jexl();

  // === Global functions ===
  jexl.addFunction(
    "_if",
    (cond: unknown, trueVal: unknown, falseVal?: unknown) =>
      cond ? trueVal : (falseVal ?? null),
  );
  jexl.addFunction("now", () => Date.now());
  jexl.addFunction("today", () => startOfDayMs(Date.now()));
  jexl.addFunction("date", (s: string) => new Date(s).getTime());
  jexl.addFunction("duration", (s: string) => parseDurationMs(s));
  jexl.addFunction("min", (...args: number[]) => Math.min(...args));
  jexl.addFunction("max", (...args: number[]) => Math.max(...args));
  jexl.addFunction("number", (v: unknown) => {
    if (typeof v === "boolean") return v ? 1 : 0;
    return Number(v);
  });
  jexl.addFunction("list", (v: unknown) => (Array.isArray(v) ? v : [v]));
  jexl.addFunction("link", (path: string, display?: string) => display || path);
  jexl.addFunction("icon", (name: string) => `[${name}]`);

  // === Number transforms ===
  jexl.addTransform("abs", (v: number) => Math.abs(v));
  jexl.addTransform("ceil", (v: number) => Math.ceil(v));
  jexl.addTransform("floor", (v: number) => Math.floor(v));
  jexl.addTransform("round", (v: number, digits?: number) => {
    const f = 10 ** (digits || 0);
    return Math.round(v * f) / f;
  });
  jexl.addTransform("toFixed", (v: number, precision: number) =>
    Number(v).toFixed(precision),
  );

  // === String transforms ===
  jexl.addTransform("contains", (v: unknown, sub: unknown) => {
    if (Array.isArray(v)) return v.includes(sub);
    return String(v).includes(String(sub));
  });
  jexl.addTransform("containsAll", (v: unknown, ...subs: unknown[]) => {
    if (Array.isArray(v)) return subs.every((s) => v.includes(s));
    const s = String(v);
    return subs.every((sub) => s.includes(String(sub)));
  });
  jexl.addTransform("containsAny", (v: unknown, ...subs: unknown[]) => {
    if (Array.isArray(v)) return subs.some((s) => v.includes(s));
    const s = String(v);
    return subs.some((sub) => s.includes(String(sub)));
  });
  jexl.addTransform("startsWith", (v: string, q: string) =>
    String(v).startsWith(q),
  );
  jexl.addTransform("endsWith", (v: string, q: string) =>
    String(v).endsWith(q),
  );
  jexl.addTransform("lower", (v: string) => String(v).toLowerCase());
  jexl.addTransform("title", (v: string) =>
    String(v).replace(/\b\w/g, (c) => c.toUpperCase()),
  );
  jexl.addTransform("trim", (v: string) => String(v).trim());
  jexl.addTransform("replace", (v: string, pat: string, rep: string) =>
    String(v).replace(pat, rep),
  );
  jexl.addTransform("repeat", (v: string, n: number) => String(v).repeat(n));
  jexl.addTransform("reverse", (v: unknown) => {
    if (Array.isArray(v)) return [...v].reverse();
    return String(v).split("").reverse().join("");
  });
  jexl.addTransform("slice", (v: unknown, start: number, end?: number) => {
    if (Array.isArray(v)) return v.slice(start, end);
    return String(v).slice(start, end);
  });
  jexl.addTransform("split", (v: string, sep: string, n?: number) => {
    const parts = String(v).split(sep);
    return n ? parts.slice(0, n) : parts;
  });
  jexl.addTransform("toString", (v: unknown) => String(v));

  // === Date transforms ===
  jexl.addTransform("format", (v: number, fmt: string) => {
    const d = new Date(v);
    return fmt
      .replace("YYYY", String(d.getFullYear()))
      .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
      .replace("DD", String(d.getDate()).padStart(2, "0"))
      .replace("HH", String(d.getHours()).padStart(2, "0"))
      .replace("mm", String(d.getMinutes()).padStart(2, "0"))
      .replace("ss", String(d.getSeconds()).padStart(2, "0"));
  });
  jexl.addTransform("date", (v: number) => startOfDayMs(v));
  jexl.addTransform("time", (v: number) => {
    const d = new Date(v);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  });
  jexl.addTransform("relative", relativeTime);

  // === Date field transforms (act as property access) ===
  jexl.addTransform("_year", (v: number) => new Date(v).getFullYear());
  jexl.addTransform("_month", (v: number) => new Date(v).getMonth() + 1);
  jexl.addTransform("_day", (v: number) => new Date(v).getDate());
  jexl.addTransform("_hour", (v: number) => new Date(v).getHours());
  jexl.addTransform("_minute", (v: number) => new Date(v).getMinutes());
  jexl.addTransform("_second", (v: number) => new Date(v).getSeconds());
  jexl.addTransform("_millisecond", (v: number) =>
    new Date(v).getMilliseconds(),
  );

  // === Duration field transforms ===
  jexl.addTransform("_days", (v: number) => v / 86400000);
  jexl.addTransform("_hours", (v: number) => v / 3600000);
  jexl.addTransform("_minutes", (v: number) => v / 60000);
  jexl.addTransform("_seconds", (v: number) => v / 1000);
  jexl.addTransform("_milliseconds", (v: number) => v);

  // === List transforms ===
  jexl.addTransform("join", (v: unknown[], sep: string) =>
    Array.isArray(v) ? v.join(sep) : String(v),
  );
  jexl.addTransform("sort", (v: unknown[]) =>
    Array.isArray(v) ? [...v].sort() : v,
  );
  jexl.addTransform("unique", (v: unknown[]) =>
    Array.isArray(v) ? [...new Set(v)] : v,
  );
  jexl.addTransform("flat", (v: unknown[]) =>
    Array.isArray(v) ? v.flat() : v,
  );

  // === Any transforms ===
  jexl.addTransform("isEmpty", (v: unknown) => {
    if (v === null || v === undefined || v === "") return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v).length === 0;
    return false;
  });
  jexl.addTransform("isTruthy", (v: unknown) => !!v);
  jexl.addTransform("isType", (v: unknown, type: string) => {
    if (type === "string") return typeof v === "string";
    if (type === "number") return typeof v === "number";
    if (type === "boolean") return typeof v === "boolean";
    if (type === "list") return Array.isArray(v);
    return false;
  });
  jexl.addTransform("_length", (v: unknown) => {
    if (typeof v === "string") return v.length;
    if (Array.isArray(v)) return v.length;
    return 0;
  });

  // === Object transforms ===
  jexl.addTransform("keys", (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [],
  );
  jexl.addTransform("values", (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.values(v) : [],
  );

  // === File-like transforms (operate on context objects) ===
  jexl.addTransform(
    "hasTag",
    (file: { tags?: string[] }, ...tags: string[]) => {
      if (!file?.tags) return false;
      return tags.some((t) =>
        file.tags?.some((ft) => ft === t || ft.startsWith(`${t}/`)),
      );
    },
  );
  jexl.addTransform("hasLink", (file: { links?: string[] }, target: string) => {
    if (!file?.links) return false;
    return file.links.includes(target);
  });
  jexl.addTransform(
    "hasProperty",
    (file: { properties?: Record<string, unknown> }, name: string) => {
      if (!file?.properties) return false;
      return name in file.properties;
    },
  );
  jexl.addTransform("inFolder", (file: { folder?: string }, folder: string) => {
    if (!file?.folder) return false;
    return file.folder === folder || file.folder.startsWith(`${folder}/`);
  });
  jexl.addTransform(
    "asLink",
    (file: { name?: string }, display?: string) => display || file?.name || "",
  );

  // === Regex ===
  jexl.addTransform("matches", (pattern: string, target: string) => {
    try {
      return new RegExp(pattern).test(target);
    } catch {
      return false;
    }
  });

  return jexl;
}

/** Human-relative time: "just now", "5 minutes ago", "in 2 days". */
function relativeTime(v: number): string {
  const diff = Date.now() - v;
  const abs = Math.abs(diff);
  if (abs < 60000) return "just now";
  const [n, word] =
    abs < 3600000
      ? [Math.floor(abs / 60000), "minute"]
      : abs < 86400000
        ? [Math.floor(abs / 3600000), "hour"]
        : [Math.floor(abs / 86400000), "day"];
  const label = `${n} ${word}${n > 1 ? "s" : ""}`;
  return diff > 0 ? `${label} ago` : `in ${label}`;
}

const FILE_META_COLS = new Set([
  "path",
  "name",
  "basename",
  "folder",
  "ext",
  "size",
  "ctime",
  "mtime",
]);

// JSON-serialized file columns and their parse-failure fallbacks.
const FILE_JSON_COLS: Record<string, { key: string; fallback: unknown }> = {
  tags: { key: "tags", fallback: [] },
  links: { key: "links", fallback: [] },
  backlinks: { key: "backlinks", fallback: [] },
  embeds: { key: "embeds", fallback: [] },
  file_properties: { key: "properties", fallback: {} },
};

function parseJsonOr(val: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(val as string);
  } catch {
    return fallback;
  }
}

/** JSON lists/objects parse; everything else stays as-is. */
function parseMaybeJson(val: unknown): unknown {
  if (typeof val !== "string") return val;
  try {
    const p = JSON.parse(val);
    return typeof p === "object" ? p : val;
  } catch {
    return val;
  }
}

/**
 * Build a context object for formula evaluation from a database row.
 */
export function buildFormulaContext(
  columns: string[],
  row: unknown[],
  formulaResults: Record<string, unknown> = {},
  thisFile?: { name: string; path: string; folder: string },
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  const file: Record<string, unknown> = {};
  const note: Record<string, unknown> = {};

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const val = row[i];

    if (FILE_META_COLS.has(col)) {
      file[col] = val;
    } else if (col in FILE_JSON_COLS) {
      const { key, fallback } = FILE_JSON_COLS[col];
      file[key] = parseJsonOr(val, fallback);
    } else {
      // Frontmatter properties (already stripped of prop_ prefix by
      // queryBase); bare property access doubles as shorthand.
      const parsed = parseMaybeJson(val);
      note[col] = parsed;
      ctx[col] = parsed;
    }
  }

  ctx.formula = { ...formulaResults };
  ctx.file = file;
  ctx.note = note;
  if (thisFile) ctx.this = { file: thisFile };

  return ctx;
}

/**
 * Evaluate all formulas for a single row.
 * Handles formula dependencies (formula referencing another formula).
 */
export async function evaluateFormulas(
  engine: InstanceType<typeof Jexl.Jexl>,
  formulas: Record<string, string>,
  columns: string[],
  row: unknown[],
  thisFile?: { name: string; path: string; folder: string },
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const remaining = { ...formulas };
  let iterations = 0;
  const maxIterations = Object.keys(formulas).length + 1;

  while (Object.keys(remaining).length > 0 && iterations < maxIterations) {
    iterations++;
    let resolved = false;
    for (const [name, expr] of Object.entries(remaining)) {
      // Check if this formula depends on unresolved formulas
      const deps = Object.keys(remaining).filter(
        (k) => k !== name && expr.includes(`formula.${k}`),
      );
      if (deps.length > 0) continue;

      const ctx = buildFormulaContext(columns, row, results, thisFile);
      try {
        const jexlExpr = obsidianToJexl(expr);
        results[name] = await engine.eval(jexlExpr, ctx);
      } catch {
        results[name] = null;
      }
      delete remaining[name];
      resolved = true;
    }
    if (!resolved) break; // Circular dependency, bail
  }

  // Any remaining (circular deps) get null
  for (const name of Object.keys(remaining)) {
    results[name] = null;
  }

  return results;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DURATION_UNIT_MS: Record<string, number> = {
  y: 365.25 * DAY_MS,
  year: 365.25 * DAY_MS,
  years: 365.25 * DAY_MS,
  M: 30.44 * DAY_MS,
  month: 30.44 * DAY_MS,
  months: 30.44 * DAY_MS,
  w: 7 * DAY_MS,
  week: 7 * DAY_MS,
  weeks: 7 * DAY_MS,
  d: DAY_MS,
  day: DAY_MS,
  days: DAY_MS,
  h: HOUR_MS,
  hour: HOUR_MS,
  hours: HOUR_MS,
  m: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  s: 1000,
  second: 1000,
  seconds: 1000,
};

/** Parse a duration string ("7d", "1 week", "2h") into milliseconds. */
export function parseDurationMs(dur: string): number {
  const match = dur.match(
    /^(\d+)\s*(y|year|years|M|month|months|d|day|days|w|week|weeks|h|hour|hours|m|minute|minutes|s|second|seconds)$/,
  );
  if (!match) return 0;
  return Number.parseInt(match[1], 10) * (DURATION_UNIT_MS[match[2]] ?? 0);
}
