import type { OverviewFolder } from "../core/overview.js";
import { Napkin } from "../sdk.js";
import {
  bold,
  dim,
  type OutputOptions,
  output,
  warn,
} from "../utils/output.js";

/** One primer row: path, about, contains roster, topics, keywords, count. */
function printFolderRow(f: OverviewFolder): void {
  const collapsedNote = f.collapsedFolders
    ? dim(` (+${f.collapsedFolders} similar subfolders)`)
    : "";
  console.log(bold(f.path === "/" ? "./" : `${f.path}/`) + collapsedNote);
  if (f.about) {
    console.log(`  ${dim("about:")} ${f.about}`);
  }
  if (f.contains && f.contains.length > 0) {
    const more = (f.collapsedFolders ?? 0) - f.contains.length;
    console.log(
      `  ${dim("contains:")} ${f.contains.join(", ")}${more > 0 ? dim(` (+${more} more)`) : ""}`,
    );
  }
  for (const t of f.topics ?? []) {
    const terms = t.terms.length > 0 ? `: ${t.terms.join(", ")}` : "";
    console.log(`  ${dim("·")} ${t.label} ${dim(`(${t.notes})`)}${terms}`);
  }
  if (f.keywords.length > 0) {
    console.log(`  ${dim("keywords:")} ${f.keywords.join(", ")}`);
  }
  // Tags stay in --json; in the primer they cost tokens without carrying
  // routing signal.
  console.log(`  ${dim("notes:")} ${f.notes}`);
}

export async function overview(
  opts: OutputOptions & {
    vault?: string;
    depth?: string;
    keywords?: string;
    collapse?: boolean;
  },
) {
  const n = new Napkin(opts.vault || process.cwd());
  const result = n.overview({
    depth: opts.depth ? Number.parseInt(opts.depth, 10) : undefined,
    keywords: opts.keywords ? Number.parseInt(opts.keywords, 10) : undefined,
    ...(opts.collapse === false ? { collapse: false } : {}),
  });

  for (const w of result.warnings ?? []) {
    warn(w);
  }

  output(opts, {
    json: () => result,
    human: () => {
      console.log(
        dim("WORKFLOW: overview (you are here) → search <query> → read <file>"),
      );
      console.log("");
      if (result.context) {
        console.log(bold("CONTEXT"));
        console.log(result.context);
        console.log("");
      }
      if (result.overview.length === 0) {
        console.log("Empty vault");
        return;
      }
      for (const f of result.overview) printFolderRow(f);
      console.log("");
      console.log(
        dim(
          "HINT: Use napkin search <query> to find specific content. Use napkin read <file> to open a file.",
        ),
      );
    },
  });
}
