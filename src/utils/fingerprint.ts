import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { listFiles } from "./files.js";

/**
 * Compute a fingerprint of all .md files in the vault based on paths and mtimes.
 * Changes when files are added, removed, or modified. Keys both the search
 * cache and the overview cache.
 */
export function computeFingerprint(
  contentPath: string,
  folder?: string,
): string {
  const files = listFiles(contentPath, { folder, ext: "md" });
  const entries: string[] = [];

  for (const file of files) {
    const stat = fs.statSync(path.join(contentPath, file));
    entries.push(`${file}:${stat.mtimeMs}`);
  }

  return crypto.createHash("md5").update(entries.join("\n")).digest("hex");
}
