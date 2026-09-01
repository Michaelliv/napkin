import * as fs from "node:fs";
import * as path from "node:path";
import { effectiveConfig } from "../utils/config.js";
import { listFiles, resolveFile } from "../utils/files.js";
import type { VaultInfo } from "../utils/vault.js";

function getTemplateFolder(vault: VaultInfo): string {
  return effectiveConfig(vault).templates.folder;
}

export function listTemplates(v: VaultInfo): string[] {
  const folder = getTemplateFolder(v);
  return listFiles(v.contentPath, { folder, ext: "md" }).map((f) =>
    path.basename(f, ".md"),
  );
}

function resolveVariables(content: string, title?: string): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return content
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{time\}\}/g, timeStr)
    .replace(/\{\{title\}\}/g, title || "Untitled");
}

export function readTemplate(
  v: VaultInfo,
  name: string,
  opts?: { resolve?: boolean; title?: string },
): { template: string; content: string } {
  const folder = getTemplateFolder(v);
  const resolved =
    resolveFile(v.contentPath, `${folder}/${name}`) ||
    resolveFile(v.contentPath, name);
  if (!resolved) {
    const templateFiles = listFiles(v.contentPath, { folder, ext: "md" }).map(
      (f) => path.basename(f, ".md"),
    );
    throw new Error(
      `Template not found: ${name}. Available: ${templateFiles.slice(0, 3).join(", ")}`,
    );
  }

  let content = fs.readFileSync(path.join(v.contentPath, resolved), "utf-8");

  if (opts?.resolve) {
    content = resolveVariables(content, opts.title);
  }

  return { template: name, content };
}

export function insertTemplate(
  v: VaultInfo,
  templateName: string,
  fileRef: string,
): { file: string; template: string; inserted: boolean } {
  const folder = getTemplateFolder(v);
  const templateResolved =
    resolveFile(v.contentPath, `${folder}/${templateName}`) ||
    resolveFile(v.contentPath, templateName);
  if (!templateResolved) {
    const templateFiles = listFiles(v.contentPath, { folder, ext: "md" }).map(
      (f) => path.basename(f, ".md"),
    );
    throw new Error(
      `Template not found: ${templateName}. Available: ${templateFiles.slice(0, 3).join(", ")}`,
    );
  }

  const targetResolved = resolveFile(v.contentPath, fileRef);
  if (!targetResolved) {
    throw new Error(`File not found: ${fileRef}`);
  }

  const title = path.basename(targetResolved, ".md");
  let templateContent = fs.readFileSync(
    path.join(v.contentPath, templateResolved),
    "utf-8",
  );
  templateContent = resolveVariables(templateContent, title);

  const targetPath = path.join(v.contentPath, targetResolved);
  const existing = fs.readFileSync(targetPath, "utf-8");
  fs.writeFileSync(targetPath, existing + templateContent);

  return { file: targetResolved, template: templateName, inserted: true };
}
