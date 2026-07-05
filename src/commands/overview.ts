import { Napkin } from "../sdk.js";
import {
  bold,
  dim,
  type OutputOptions,
  output,
  warn,
} from "../utils/output.js";

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
      for (const f of result.overview) {
        const collapsedNote = f.collapsedFolders
          ? dim(` (+${f.collapsedFolders} similar subfolders)`)
          : "";
        console.log(bold(f.path === "/" ? "./" : `${f.path}/`) + collapsedNote);
        if (f.keywords.length > 0) {
          console.log(`  ${dim("keywords:")} ${f.keywords.join(", ")}`);
        }
        if (f.tags.length > 0) {
          console.log(
            `  ${dim("tags:")} ${f.tags.map((t) => `#${t}`).join(", ")}`,
          );
        }
        console.log(`  ${dim("notes:")} ${f.notes}`);
      }
      console.log("");
      console.log(
        dim(
          "HINT: Use napkin search <query> to find specific content. Use napkin read <file> to open a file.",
        ),
      );
    },
  });
}
