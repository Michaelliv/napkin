import * as fs from "node:fs";
import * as path from "node:path";
import { effectiveConfig } from "../utils/config.js";
import { listFiles, resolveFile } from "../utils/files.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { VaultInfo } from "../utils/vault.js";

export interface ReadResult {
  path: string;
  content: string;
}

export interface CreateOptions {
  name?: string;
  path?: string;
  content?: string;
  template?: string;
  overwrite?: boolean;
}

export interface CreateResult {
  path: string;
  created: boolean;
}

export interface MoveResult {
  from: string;
  to: string;
}

export interface DeleteResult {
  path: string;
  deleted: boolean;
  permanent: boolean;
}

export function readFile(vaultPath: string, fileRef: string): ReadResult {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }
  const content = fs.readFileSync(path.join(vaultPath, resolved), "utf-8");
  return { path: resolved, content };
}

export function createFile(v: VaultInfo, opts: CreateOptions): CreateResult {
  let targetPath: string;
  if (opts.path) {
    targetPath = opts.path.endsWith(".md") ? opts.path : `${opts.path}.md`;
  } else {
    const name = opts.name || "Untitled";
    targetPath = `${name}.md`;
  }

  const fullPath = path.join(v.contentPath, targetPath);

  if (fs.existsSync(fullPath) && !opts.overwrite) {
    throw new Error(
      `File already exists: ${targetPath}. Use --overwrite to replace.`,
    );
  }

  let content = opts.content || "";

  if (opts.template) {
    const config = effectiveConfig(v);
    const templateRef =
      resolveFile(v.contentPath, opts.template) ||
      resolveFile(v.contentPath, `${config.templates.folder}/${opts.template}`);
    if (templateRef) {
      content = fs.readFileSync(path.join(v.contentPath, templateRef), "utf-8");
    } else {
      const tmplFiles = listFiles(v.contentPath, {
        folder: config.templates.folder,
        ext: "md",
      }).map((f: string) => path.basename(f, ".md"));
      throw new Error(
        `Template not found: ${opts.template}. Available: ${tmplFiles.slice(0, 3).join(", ")}`,
      );
    }
  }

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);

  return { path: targetPath, created: true };
}

export function appendFile(
  vaultPath: string,
  fileRef: string,
  content: string,
  inline?: boolean,
): string {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }

  const fullPath = path.join(vaultPath, resolved);
  const existing = fs.readFileSync(fullPath, "utf-8");
  const separator = inline ? "" : "\n";
  fs.writeFileSync(fullPath, existing + separator + content);

  return resolved;
}

export function prependFile(
  vaultPath: string,
  fileRef: string,
  content: string,
  inline?: boolean,
): string {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }

  const fullPath = path.join(vaultPath, resolved);
  const existing = fs.readFileSync(fullPath, "utf-8");
  const separator = inline ? "" : "\n";

  const { properties, body, raw } = parseFrontmatter(existing);
  if (Object.keys(properties).length > 0) {
    const frontmatter = `---\n${raw}\n---\n`;
    fs.writeFileSync(fullPath, frontmatter + content + separator + body);
  } else {
    fs.writeFileSync(fullPath, content + separator + existing);
  }

  return resolved;
}

export function moveFile(
  vaultPath: string,
  fileRef: string,
  destination: string,
): MoveResult {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }

  let destPath = destination;
  if (!destPath.endsWith(".md")) {
    destPath = path.join(destPath, path.basename(resolved));
  }

  const srcFull = path.join(vaultPath, resolved);
  const destFull = path.join(vaultPath, destPath);
  fs.mkdirSync(path.dirname(destFull), { recursive: true });
  fs.renameSync(srcFull, destFull);

  return { from: resolved, to: destPath };
}

export function renameFile(
  vaultPath: string,
  fileRef: string,
  newName: string,
): MoveResult {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }

  const name = newName.endsWith(".md") ? newName : `${newName}.md`;
  const destPath = path.join(path.dirname(resolved), name);
  const srcFull = path.join(vaultPath, resolved);
  const destFull = path.join(vaultPath, destPath);
  fs.renameSync(srcFull, destFull);

  return { from: resolved, to: destPath };
}

export function deleteFile(
  vaultPath: string,
  fileRef: string,
  permanent?: boolean,
): DeleteResult {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }

  const fullPath = path.join(vaultPath, resolved);

  if (permanent) {
    fs.unlinkSync(fullPath);
  } else {
    const trashDir = path.join(vaultPath, ".trash");
    fs.mkdirSync(trashDir, { recursive: true });
    const trashPath = path.join(trashDir, path.basename(resolved));
    fs.renameSync(fullPath, trashPath);
  }

  return { path: resolved, deleted: true, permanent: !!permanent };
}
