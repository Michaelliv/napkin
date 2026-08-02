import matter from "gray-matter";

// Runtime-only API not present in gray-matter's type declarations.
const matterCache = matter as unknown as { clearCache: () => void };

/**
 * gray-matter caches the file object keyed by content BEFORE parsing it, so
 * a failed parse leaves a poisoned entry: the next parse of a byte-identical
 * string silently returns the cached, unparsed object (empty data, no error).
 * Evict the cache when parsing throws so every parse of malformed content
 * fails deterministically.
 */
function safeMatter(content: string): matter.GrayMatterFile<string> {
  try {
    return matter(content);
  } catch (err) {
    matterCache.clearCache();
    throw err;
  }
}

export interface ParsedFrontmatter {
  properties: Record<string, unknown>;
  body: string;
  raw: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const result = safeMatter(content);
  return {
    properties: result.data,
    body: result.content,
    raw: result.matter,
  };
}

/**
 * Set a property in frontmatter, creating the --- block if needed.
 */
export function setProperty(
  content: string,
  name: string,
  value: unknown,
): string {
  const result = safeMatter(content);
  const data = { ...result.data, [name]: value };
  return matter.stringify(result.content, data);
}

/**
 * Remove a property from frontmatter.
 */
export function removeProperty(content: string, name: string): string {
  const result = safeMatter(content);
  const data = { ...result.data };
  delete data[name];
  // If no properties left, return just the body
  if (Object.keys(data).length === 0) {
    const body = result.content;
    return body.startsWith("\n") ? body.slice(1) : body;
  }
  return matter.stringify(result.content, data);
}
