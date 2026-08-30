import * as fs from "node:fs";
import * as path from "node:path";
import { buildLinkResolver, listFiles, resolveFile } from "../utils/files.js";
import { extractLinks } from "../utils/markdown.js";

export interface VaultLinks {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  unresolved: Map<string, string[]>;
}

function append(map: Map<string, string[]>, key: string, value: string): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)?.push(value);
}

export function buildLinkIndex(vaultPath: string): VaultLinks {
  const files = listFiles(vaultPath, { ext: "md" });
  // Batch resolution with loose (shallowest-match) semantics: an ambiguous
  // wikilink resolves like Obsidian instead of failing the whole index.
  const resolve = buildLinkResolver(files);
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();

  for (const f of files) incoming.set(f, []);

  for (const file of files) {
    const content = fs.readFileSync(path.join(vaultPath, file), "utf-8");
    const links = extractLinks(content);
    outgoing.set(file, links.outgoing);

    for (const target of links.wikilinks) {
      const resolved = resolve(target);
      if (resolved) append(incoming, resolved, file);
      else append(unresolved, target, file);
    }
  }

  return { outgoing, incoming, unresolved };
}

export function getBacklinks(vaultPath: string, fileRef: string): string[] {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }
  const { incoming } = buildLinkIndex(vaultPath);
  return incoming.get(resolved) || [];
}

export function getOutgoingLinks(vaultPath: string, fileRef: string): string[] {
  const resolved = resolveFile(vaultPath, fileRef);
  if (!resolved) {
    throw new Error(`File not found: ${fileRef}`);
  }
  const content = fs.readFileSync(path.join(vaultPath, resolved), "utf-8");
  const { outgoing } = extractLinks(content);
  return outgoing;
}

export function getUnresolvedLinks(vaultPath: string): [string, string[]][] {
  const { unresolved } = buildLinkIndex(vaultPath);
  return [...unresolved.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function getOrphans(vaultPath: string): string[] {
  const { incoming } = buildLinkIndex(vaultPath);
  return [...incoming.entries()]
    .filter(([_, links]) => links.length === 0)
    .map(([file]) => file)
    .sort();
}

export function getDeadends(vaultPath: string): string[] {
  const { outgoing } = buildLinkIndex(vaultPath);
  return [...outgoing.entries()]
    .filter(([_, links]) => links.length === 0)
    .map(([file]) => file)
    .sort();
}
