import type { Canvas, CanvasNode } from "../core/canvas.js";
import { Napkin } from "../sdk.js";
import { EXIT_NOT_FOUND, EXIT_USER_ERROR } from "../utils/exit-codes.js";
import {
  bold,
  dim,
  error,
  type OutputOptions,
  output,
  success,
} from "../utils/output.js";

/** One-line description of a node for listings. */
function nodeSummary(node: CanvasNode, groupFallback = ""): string {
  switch (node.type) {
    case "text":
      return (node.text?.split("\n")[0] || "").slice(0, 60);
    case "file":
      return node.file ?? "";
    case "link":
      return node.url ?? "";
    case "group":
      return node.label || groupFallback;
  }
}

export async function canvases(
  opts: OutputOptions & { vault?: string; total?: boolean },
) {
  const n = new Napkin(opts.vault || process.cwd());
  const files = n.canvases();

  output(opts, {
    json: () => (opts.total ? { total: files.length } : { canvases: files }),
    human: () => {
      if (opts.total) {
        console.log(files.length);
      } else if (files.length === 0) {
        console.log("No .canvas files found");
      } else {
        for (const f of files) console.log(f);
      }
    },
  });
}

export async function canvasRead(
  opts: OutputOptions & { vault?: string; file?: string },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No file specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }

  let canvas: Canvas;
  let filePath: string;
  try {
    ({ canvas, filePath } = n.canvasRead(opts.file));
  } catch (e: unknown) {
    error((e as Error).message);
    process.exit(EXIT_NOT_FOUND);
  }

  output(opts, {
    json: () => ({ path: filePath, ...canvas }),
    human: () => {
      console.log(bold(filePath));
      console.log(`${canvas.nodes.length} nodes, ${canvas.edges.length} edges`);
      console.log();
      for (const node of canvas.nodes) {
        const desc = nodeSummary(node, "(unnamed group)");
        console.log(
          `  ${dim(node.id.slice(0, 8))}  ${node.type.padEnd(6)} ${desc}`,
        );
      }
      if (canvas.edges.length > 0) {
        console.log();
        for (const edge of canvas.edges) {
          const label = edge.label ? ` "${edge.label}"` : "";
          console.log(
            `  ${dim(edge.id.slice(0, 8))}  ${edge.fromNode.slice(0, 8)} → ${edge.toNode.slice(0, 8)}${label}`,
          );
        }
      }
    },
  });
}

export async function canvasNodes(
  opts: OutputOptions & { vault?: string; file?: string; type?: string },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No file specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }

  let canvas: Canvas;
  try {
    ({ canvas } = n.canvasRead(opts.file));
  } catch (e: unknown) {
    error((e as Error).message);
    process.exit(EXIT_NOT_FOUND);
  }
  let nodes = canvas.nodes;
  if (opts.type) {
    nodes = nodes.filter((n) => n.type === opts.type);
  }

  output(opts, {
    json: () => ({ nodes }),
    human: () => {
      for (const node of nodes) {
        console.log(`${node.id}  ${node.type.padEnd(6)} ${nodeSummary(node)}`);
      }
    },
  });
}

export async function canvasCreate(
  opts: OutputOptions & { vault?: string; file?: string; path?: string },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No file name specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }

  let result: { path: string; created: boolean };
  try {
    result = n.canvasCreate(opts.file, opts.path);
  } catch (e: unknown) {
    error((e as Error).message);
    process.exit(EXIT_USER_ERROR);
  }

  output(opts, {
    json: () => result,
    human: () => success(`Created ${result.path}`),
  });
}

export async function canvasAddNode(
  opts: OutputOptions & {
    vault?: string;
    file?: string;
    type?: string;
    text?: string;
    noteFile?: string;
    subpath?: string;
    url?: string;
    label?: string;
    x?: string;
    y?: string;
    width?: string;
    height?: string;
    color?: string;
  },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No canvas file specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }

  let result: { id: string; type: string; added: boolean };
  try {
    result = n.canvasAddNode(opts.file, opts);
  } catch (e: unknown) {
    error((e as Error).message);
    process.exit(EXIT_NOT_FOUND);
  }

  output(opts, {
    json: () => result,
    human: () => success(`Added ${result.type} node ${result.id}`),
  });
}

export async function canvasAddEdge(
  opts: OutputOptions & {
    vault?: string;
    file?: string;
    from?: string;
    to?: string;
    fromSide?: string;
    toSide?: string;
    label?: string;
    color?: string;
  },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file) {
    error("No canvas file specified. Use --file <name>");
    process.exit(EXIT_USER_ERROR);
  }
  if (!opts.from || !opts.to) {
    error("Both --from and --to node IDs required");
    process.exit(EXIT_USER_ERROR);
  }

  let result: { id: string; from: string; to: string; added: boolean };
  try {
    result = n.canvasAddEdge(opts.file, {
      from: opts.from,
      to: opts.to,
      fromSide: opts.fromSide,
      toSide: opts.toSide,
      label: opts.label,
      color: opts.color,
    });
  } catch (e: unknown) {
    error((e as Error).message);
    process.exit(EXIT_NOT_FOUND);
  }

  output(opts, {
    json: () => result,
    human: () =>
      success(
        `Added edge ${result.from.slice(0, 8)} → ${result.to.slice(0, 8)}`,
      ),
  });
}

export async function canvasRemoveNode(
  opts: OutputOptions & {
    vault?: string;
    file?: string;
    id?: string;
  },
) {
  const n = new Napkin(opts.vault || process.cwd());
  if (!opts.file || !opts.id) {
    error("Both --file and --id required");
    process.exit(EXIT_USER_ERROR);
  }

  let result: { id: string; removed: boolean };
  try {
    result = n.canvasRemoveNode(opts.file, opts.id);
  } catch (e: unknown) {
    error((e as Error).message);
    process.exit(EXIT_NOT_FOUND);
  }

  output(opts, {
    json: () => result,
    human: () => success(`Removed node ${result.id}`),
  });
}
