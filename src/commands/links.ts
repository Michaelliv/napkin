import { Napkin } from "../sdk.js";
import { EXIT_NOT_FOUND, EXIT_USER_ERROR } from "../utils/exit-codes.js";
import { suggestFile } from "../utils/files.js";
import {
  dim,
  error,
  fileNotFound,
  type OutputOptions,
  output,
} from "../utils/output.js";

export async function backlinks(
  opts: OutputOptions & {
    vault?: string;
    file?: string;
    counts?: boolean;
    total?: boolean;
  },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No file specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }

  let links: string[];
  try {
    links = n.linksBack(opts.file);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.startsWith("File not found:")) {
      fileNotFound(opts.file, suggestFile(n.vault.contentPath, opts.file));
      process.exit(EXIT_NOT_FOUND);
    }
    throw e;
  }

  output(opts, {
    json: () => (opts.total ? { total: links.length } : { backlinks: links }),
    human: () => {
      if (opts.total) console.log(links.length);
      else for (const l of links) console.log(l);
    },
  });
}

export async function links(
  opts: OutputOptions & { vault?: string; file?: string; total?: boolean },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No file specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }

  let outgoing: string[];
  try {
    outgoing = n.linksOut(opts.file);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.startsWith("File not found:")) {
      fileNotFound(opts.file, suggestFile(n.vault.contentPath, opts.file));
      process.exit(EXIT_NOT_FOUND);
    }
    throw e;
  }

  output(opts, {
    json: () => (opts.total ? { total: outgoing.length } : { links: outgoing }),
    human: () => {
      if (opts.total) console.log(outgoing.length);
      else for (const l of outgoing) console.log(l);
    },
  });
}

function printUnresolved(
  entries: [string, string[]][],
  opts: { counts?: boolean; verbose?: boolean },
): void {
  for (const [target, sources] of entries) {
    console.log(opts.counts ? `${target}\t${sources.length}` : target);
    if (opts.verbose) {
      for (const s of sources) console.log(`  ${dim(s)}`);
    }
  }
}

export async function unresolvedLinks(
  opts: OutputOptions & {
    vault?: string;
    total?: boolean;
    counts?: boolean;
    verbose?: boolean;
  },
) {
  const n = new Napkin(opts.vault || process.cwd());
  const entries = n.linksUnresolved();

  output(opts, {
    json: () => {
      if (opts.total) return { total: entries.length };
      if (opts.counts || opts.verbose)
        return {
          unresolved: Object.fromEntries(
            entries.map(([k, v]) => [k, opts.verbose ? v : v.length]),
          ),
        };
      return { unresolved: entries.map(([k]) => k) };
    },
    human: () => {
      if (opts.total) console.log(entries.length);
      else printUnresolved(entries, opts);
    },
  });
}

export async function orphans(
  opts: OutputOptions & { vault?: string; total?: boolean },
) {
  const n = new Napkin(opts.vault || process.cwd());
  const result = n.orphans();

  output(opts, {
    json: () => (opts.total ? { total: result.length } : { orphans: result }),
    human: () => {
      if (opts.total) console.log(result.length);
      else for (const f of result) console.log(f);
    },
  });
}

export async function deadends(
  opts: OutputOptions & { vault?: string; total?: boolean },
) {
  const n = new Napkin(opts.vault || process.cwd());
  const result = n.deadends();

  output(opts, {
    json: () => (opts.total ? { total: result.length } : { deadends: result }),
    human: () => {
      if (opts.total) console.log(result.length);
      else for (const f of result) console.log(f);
    },
  });
}
