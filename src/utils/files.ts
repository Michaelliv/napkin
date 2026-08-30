import * as fs from "node:fs";
import * as path from "node:path";
import { INTERNAL_FILES, SKIP_DIRS } from "./vault-internals.js";

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  created: number;
  modified: number;
}

export interface ListFilesOptions {
  folder?: string;
  ext?: string;
}

/**
 * Recursively list files in a vault, skipping .obsidian, .git, .trash, node_modules.
 */
export function listFiles(
  vaultPath: string,
  opts?: ListFilesOptions,
): string[] {
  const results: string[] = [];

  const baseDir = opts?.folder ? path.join(vaultPath, opts.folder) : vaultPath;
  if (!fs.existsSync(baseDir)) return results;

  const collectFile = (dir: string, name: string, fullPath: string) => {
    // Internal napkin files never appear in vault content listings.
    if (dir === vaultPath && INTERNAL_FILES.has(name)) return;
    if (opts?.ext && path.extname(name).slice(1) !== opts.ext) return;
    results.push(path.relative(vaultPath, fullPath));
  };

  const visit = (dir: string, entry: fs.Dirent) => {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
    } else if (entry.isFile()) {
      collectFile(dir, entry.name, fullPath);
    }
  };

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      visit(dir, entry);
    }
  }

  walk(baseDir);
  return results.sort();
}

/**
 * List folders in a vault, skipping hidden/system dirs.
 */
export function listFolders(
  vaultPath: string,
  parentFolder?: string,
): string[] {
  const results: string[] = [];

  const baseDir = parentFolder ? path.join(vaultPath, parentFolder) : vaultPath;
  if (!fs.existsSync(baseDir)) return results;

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(path.relative(vaultPath, fullPath));
        walk(fullPath);
      }
    }
  }

  walk(baseDir);
  return results.sort();
}

/**
 * Find all .md files matching a wikilink-style name or exact path.
 */
function findMatches(vaultPath: string, fileRef: string): string[] {
  // Exact path
  if (fileRef.includes("/") || fileRef.endsWith(".md")) {
    const ref = fileRef.endsWith(".md") ? fileRef : `${fileRef}.md`;
    const fullPath = path.join(vaultPath, ref);
    return fs.existsSync(fullPath) ? [ref] : [];
  }

  // Wikilink-style: search by basename
  const target = fileRef.toLowerCase();
  const allFiles = listFiles(vaultPath, { ext: "md" });
  return allFiles.filter(
    (file) => path.basename(file, ".md").toLowerCase() === target,
  );
}

/**
 * Resolve a file reference (wikilink-style name or exact path) to a relative path in the vault.
 * Throws on ambiguous matches so the user can disambiguate.
 */
export function resolveFile(vaultPath: string, fileRef: string): string | null {
  const matches = findMatches(vaultPath, fileRef);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous file reference "${fileRef}" matches ${matches.length} files: ${matches.join(", ")}. Use the full path to disambiguate.`,
    );
  }
  return matches[0] ?? null;
}

/**
 * Like resolveFile but never throws on ambiguous matches.
 * Returns the shallowest match (fewest path segments), matching Obsidian's behavior.
 */
export function resolveFileLoose(
  vaultPath: string,
  fileRef: string,
): string | null {
  const matches = findMatches(vaultPath, fileRef);
  if (matches.length > 1) {
    matches.sort((a, b) => a.split("/").length - b.split("/").length);
  }
  return matches[0] ?? null;
}

/**
 * Batch link resolution over a known file list. Resolves wikilink-style refs
 * with resolveFileLoose semantics (exact path, or basename match with the
 * shallowest path winning) without walking the vault per link — use this
 * when resolving many links against the same snapshot of files.
 */
export function buildLinkResolver(
  files: string[],
): (fileRef: string) => string | null {
  const fileSet = new Set(files);
  const byBasename = new Map<string, string>();
  // Sorted so equal-depth ambiguity resolves to the alphabetically first
  // path, matching resolveFileLoose's stable sort over listFiles output.
  for (const file of [...files].sort()) {
    const key = path.basename(file, ".md").toLowerCase();
    const existing = byBasename.get(key);
    if (!existing || file.split("/").length < existing.split("/").length) {
      byBasename.set(key, file);
    }
  }
  return (fileRef: string) => {
    if (fileRef.includes("/") || fileRef.endsWith(".md")) {
      const ref = fileRef.endsWith(".md") ? fileRef : `${fileRef}.md`;
      return fileSet.has(ref) ? ref : null;
    }
    return byBasename.get(fileRef.toLowerCase()) ?? null;
  };
}

/**
 * Suggest similar filenames when a file isn't found.
 * Returns up to 3 suggestions sorted by similarity.
 */
export function suggestFile(vaultPath: string, fileRef: string): string[] {
  const target = fileRef.toLowerCase();
  const allFiles = listFiles(vaultPath, { ext: "md" });
  const scored = allFiles
    .map((f) => {
      const basename = path.basename(f, ".md").toLowerCase();
      // Simple substring match scoring
      let score = 0;
      if (basename.includes(target) || target.includes(basename)) score += 3;
      // Shared prefix
      let prefix = 0;
      while (
        prefix < basename.length &&
        prefix < target.length &&
        basename[prefix] === target[prefix]
      )
        prefix++;
      score += prefix;
      return { file: f, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map((s) => s.file);
}

/**
 * Read a file's contents, resolving by name or path.
 */
export function readFile(
  vaultPath: string,
  fileRef: string,
): { path: string; content: string } {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }
  const fullPath = path.join(vaultPath, resolved);
  const content = fs.readFileSync(fullPath, "utf-8");
  return { path: resolved, content };
}

/**
 * Get file info for a resolved file path.
 */
export function getFileInfo(vaultPath: string, relativePath: string): FileInfo {
  const fullPath = path.join(vaultPath, relativePath);
  const stat = fs.statSync(fullPath);
  const ext = path.extname(relativePath);
  return {
    path: relativePath,
    name: path.basename(relativePath, ext),
    extension: ext.slice(1),
    size: stat.size,
    created: stat.birthtimeMs,
    modified: stat.mtimeMs,
  };
}
