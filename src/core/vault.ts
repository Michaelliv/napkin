import * as fs from "node:fs";
import * as path from "node:path";
import { listFiles, listFolders } from "../utils/files.js";
import type { VaultInfo } from "../utils/vault.js";
import { INTERNAL_FILES, SKIP_DIRS } from "../utils/vault-internals.js";

export interface VaultMetadata {
  name: string;
  path: string;
  files: number;
  folders: number;
  size: number;
}

function getVaultSize(vaultPath: string): number {
  let total = 0;
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (dir === vaultPath && INTERNAL_FILES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  }
  walk(vaultPath);
  return total;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getVaultMetadata(v: VaultInfo): VaultMetadata {
  const files = listFiles(v.contentPath);
  const folders = listFolders(v.contentPath);
  const size = getVaultSize(v.contentPath);

  return {
    name: v.name,
    path: v.contentPath,
    files: files.length,
    folders: folders.length,
    size,
  };
}
