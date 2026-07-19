#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { aliases } from "./commands/aliases.js";
import { baseCreate, baseQuery, bases, baseViews } from "./commands/bases.js";
import { bookmark, bookmarks } from "./commands/bookmarks.js";
import {
  canvasAddEdge,
  canvasAddNode,
  canvasCreate,
  canvases,
  canvasNodes,
  canvasRead,
  canvasRemoveNode,
} from "./commands/canvas.js";
import { configGet, configSet, configShow } from "./commands/config.js";
import {
  append,
  create,
  del,
  move,
  prepend,
  read,
  rename,
} from "./commands/crud.js";
import {
  daily,
  dailyAppend,
  dailyPath,
  dailyPrepend,
  dailyRead,
} from "./commands/daily.js";
import { file, files, folder, folders } from "./commands/files.js";
import { graph } from "./commands/graph.js";
import { init, initTemplates } from "./commands/init.js";
import {
  backlinks,
  deadends,
  links,
  orphans,
  unresolvedLinks,
} from "./commands/links.js";
import { outline } from "./commands/outline.js";
import { overview } from "./commands/overview.js";
import {
  properties,
  propertyRead,
  propertyRemove,
  propertySet,
} from "./commands/properties.js";
import { search } from "./commands/search.js";
import { tag, tags } from "./commands/tags.js";
import { task, tasks } from "./commands/tasks.js";
import {
  templateInsert,
  templateRead,
  templates,
} from "./commands/templates.js";
import { update } from "./commands/update.js";
import { vault } from "./commands/vault.js";
import { wordcount } from "./commands/wordcount.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("napkin")
  .description(
    "🧻 Knowledge system for AI agents. Local-first, file-based, progressively disclosed.",
  )
  .version(`napkin ${version}`, "-v, --version")
  .option("--json", "Output as JSON")
  .option("-q, --quiet", "Suppress output")
  .option("--vault <path>", "Vault path (default: auto-detect from cwd)")
  .option("--copy", "Copy output to clipboard")
  .showSuggestionAfterError(true)
  .helpCommand(false)
  .addHelpText("before", () => {
    showHelp();
    process.exit(0);
  });

function showHelp() {
  console.log(`Usage: napkin [options] [command]

🧻 Knowledge system for AI agents. Local-first, file-based, progressively disclosed.

Examples:
  $ napkin init --template coding    Create a vault with coding structure
  $ napkin overview                  See what's in the vault
  $ napkin search "auth"             Find content about auth
  $ napkin read "Architecture"       Read a specific file
  $ napkin update                    Update the napkin CLI

Workflow: init → overview → search → read

Getting started:
  init                 Initialize a new vault (--template, --list)
  overview             Vault map with TF-IDF keywords per folder
  vault                Show vault info (path, file count, size)
  config               Vault configuration (show, get, set)
  graph                Interactive vault graph visualization
  update               Update the napkin CLI via npm

Reading:
  read <file>          Read a file
  search <query>       Search vault (BM25 + backlinks + recency)

Writing:
  create <name>        Create a new file (--template, --content)
  append <file>        Append content to a file
  prepend <file>       Prepend content after frontmatter
  move <file> <to>     Move a file
  rename <file> <name> Rename a file
  delete <file>        Delete a file

Subcommands:
  file                 Files, folders, outline, wordcount
  daily                Daily notes (today, read, append, prepend)
  tag                  Tags and aliases
  property             Frontmatter properties (list, set, remove, read)
  task                 Tasks and checklists (list, show, toggle)
  link                 Links and graph (out, back, orphans, deadends)
  template             Note templates (list, read, insert)
  base                 Database views over vault files
  canvas               JSON Canvas operations
  bookmark             Bookmarks

Options:
  --json               Output as JSON
  -q, --quiet          Suppress output
  --vault <path>       Vault path (default: auto-detect from cwd)
  --copy               Copy output to clipboard
  -v, --version        Show version
  -h, --help           Show this help

All commands support --json for structured output.
More help: napkin <command> --help
Docs: https://github.com/Michaelliv/napkin`);
}

// ── Getting started ─────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize a new vault")
  .option("--path <path>", "Directory to initialize (default: cwd)")
  .option("--template <name>", "Scaffold with template (see init --list)")
  .option("--list", "List available vault templates")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    if (root.list) {
      await initTemplates(root);
    } else {
      await init(root);
    }
  });

program
  .command("overview")
  .description("Vault map with keywords (Level 1 progressive disclosure)")
  .option("--depth <n>", "Max folder depth")
  .option("--keywords <n>", "Max keywords per folder")
  .option("--no-collapse", "Do not roll up homogeneous sibling folders")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await overview(root);
  });

program
  .command("graph")
  .description("Interactive vault graph visualization")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await graph({}, root);
  });

program
  .command("vault")
  .description("Show vault info (path, file count, size)")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await vault(root);
  });

program
  .command("update")
  .description("Update the napkin CLI")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await update(root);
  });

// ── Reading ─────────────────────────────────────────────────────────

program
  .command("read <file>")
  .description("Read a file")
  .action(async (fileRef, _opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await read(fileRef, root);
  });

program
  .command("search [query...]")
  .description("Search vault (ranked by BM25 + backlinks + recency)")
  .option("--query <text>", "Search query")
  .option("--path <folder>", "Limit to folder")
  .option("--limit <n>", "Max results (default: 30)")
  .option("--total", "Return match count")
  .option("--snippet-lines <n>", "Context lines around matches (default: 0)")
  .option("--no-snippets", "Return files only, no snippets")
  .option("--score", "Include relevance score in output")
  .action(async (queryWords, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    if (queryWords.length && !root.query) {
      root.query = queryWords.join(" ");
    }
    await search(root);
  });

// ── Writing ─────────────────────────────────────────────────────────

program
  .command("create [name] [content]")
  .description("Create a new file")
  .option("--name <name>", "File name (alternative to positional)")
  .option("--path <path>", "File path from vault root")
  .option("--content <text>", "Initial content (alternative to positional)")
  .option("--template <name>", "Template to use")
  .option("--overwrite", "Overwrite if file exists")
  .action(async (name, content, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.name = root.name || name;
    root.content = root.content || content;
    await create(root);
  });

program
  .command("append [file] [content]")
  .description("Append content to a file")
  .option("--file <name>", "Target file (alternative to positional)")
  .option("--content <text>", "Content to append (alternative to positional)")
  .option("--inline", "Append without newline")
  .action(async (file, content, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    root.content = root.content || content;
    await append(root);
  });

program
  .command("prepend [file] [content]")
  .description("Prepend content after frontmatter")
  .option("--file <name>", "Target file (alternative to positional)")
  .option("--content <text>", "Content to prepend (alternative to positional)")
  .option("--inline", "Prepend without newline")
  .action(async (file, content, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    root.content = root.content || content;
    await prepend(root);
  });

program
  .command("move [file] [to]")
  .description("Move a file")
  .option("--file <name>", "File to move (alternative to positional)")
  .option(
    "--to <path>",
    "Destination folder or path (alternative to positional)",
  )
  .action(async (file, to, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    root.to = root.to || to;
    await move(root);
  });

program
  .command("rename [file] [name]")
  .description("Rename a file")
  .option("--file <name>", "File to rename (alternative to positional)")
  .option("--name <name>", "New file name (alternative to positional)")
  .action(async (file, name, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    root.name = root.name || name;
    await rename(root);
  });

program
  .command("delete [file]")
  .description("Delete a file")
  .option("--file <name>", "File to delete (alternative to positional)")
  .option("--permanent", "Skip trash, delete permanently")
  .action(async (file, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    await del(root);
  });

// ── file ────────────────────────────────────────────────────────────

const fileCmd = program
  .command("file")
  .description("Files, folders, and metadata");

fileCmd
  .command("info [name]")
  .description("Show file info")
  .action(async (name, _opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await file(name, root);
  });

fileCmd
  .command("list")
  .description("List files in vault")
  .option("--folder <path>", "Filter by folder")
  .option("--ext <extension>", "Filter by extension")
  .option("--total", "Return file count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await files(root);
  });

fileCmd
  .command("folder <path>")
  .description("Show folder info")
  .option("--info <type>", "Return specific info: files, folders, or size")
  .action(async (folderPath, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await folder(folderPath, root);
  });

fileCmd
  .command("folders")
  .description("List folders")
  .option("--folder <path>", "Filter by parent folder")
  .option("--total", "Return folder count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await folders(root);
  });

fileCmd
  .command("outline [file]")
  .description("Show headings for a file")
  .option("--file <name>", "File name (alternative to positional)")
  .option("--format <type>", "Output format: tree, md, json")
  .option("--total", "Return heading count")
  .action(async (file, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    await outline(root);
  });

fileCmd
  .command("wordcount [file]")
  .description("Count words and characters")
  .option("--file <name>", "File name (alternative to positional)")
  .option("--words", "Return word count only")
  .option("--characters", "Return character count only")
  .action(async (file, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.file = root.file || file;
    await wordcount(root);
  });

// ── daily ───────────────────────────────────────────────────────────

const dailyCmd = program.command("daily").description("Daily notes");

dailyCmd
  .command("today")
  .description("Create today's daily note")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await daily(root);
  });

dailyCmd
  .command("path")
  .description("Get daily note path")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await dailyPath(root);
  });

dailyCmd
  .command("read")
  .description("Read daily note contents")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await dailyRead(root);
  });

dailyCmd
  .command("append [content]")
  .description("Append to daily note")
  .option("--content <text>", "Content to append (alternative to positional)")
  .option("--inline", "Append without newline")
  .action(async (content, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.content = root.content || content;
    await dailyAppend(root);
  });

dailyCmd
  .command("prepend [content]")
  .description("Prepend to daily note")
  .option("--content <text>", "Content to prepend (alternative to positional)")
  .option("--inline", "Prepend without newline")
  .action(async (content, opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    root.content = root.content || content;
    await dailyPrepend(root);
  });

// ── tag ─────────────────────────────────────────────────────────────

const tagCmd = program.command("tag").description("Tags and aliases");

tagCmd
  .command("list")
  .description("List tags in vault")
  .option("--file <name>", "Filter by file")
  .option("--counts", "Include tag counts")
  .option("--total", "Return tag count")
  .option("--sort <by>", "Sort by: name (default) or count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await tags(root);
  });

tagCmd
  .command("info")
  .description("Get tag info")
  .option("--name <tag>", "Tag name")
  .option("--verbose", "Include file list")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await tag(root);
  });

tagCmd
  .command("aliases")
  .description("List aliases in vault")
  .option("--file <name>", "Filter by file")
  .option("--total", "Return alias count")
  .option("--verbose", "Include file paths")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await aliases(root);
  });

// ── property ────────────────────────────────────────────────────────

const propCmd = program
  .command("property")
  .description("Frontmatter properties");

propCmd
  .command("list")
  .description("List properties in vault")
  .option("--file <name>", "Filter by file")
  .option("--counts", "Include counts")
  .option("--total", "Return property count")
  .option("--sort <by>", "Sort by: name (default) or count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await properties(root);
  });

propCmd
  .command("set")
  .description("Set a property on a file")
  .option("--name <name>", "Property name")
  .option("--value <value>", "Property value")
  .option("--file <name>", "Target file")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await propertySet(root);
  });

propCmd
  .command("remove")
  .description("Remove a property from a file")
  .option("--name <name>", "Property name")
  .option("--file <name>", "Target file")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await propertyRemove(root);
  });

propCmd
  .command("read")
  .description("Read a property value")
  .option("--name <name>", "Property name")
  .option("--file <name>", "Target file")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await propertyRead(root);
  });

// ── task ────────────────────────────────────────────────────────────

const taskCmd = program.command("task").description("Tasks and checklists");

taskCmd
  .command("list")
  .description("List tasks in vault")
  .option("--file <name>", "Filter by file")
  .option("--done", "Show completed tasks")
  .option("--todo", "Show incomplete tasks")
  .option("--total", "Return task count")
  .option("--verbose", "Group by file with line numbers")
  .option("--daily", "Show tasks from daily note")
  .option("--status <char>", "Filter by status character")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await tasks(root);
  });

taskCmd
  .command("show")
  .description("Show or update a task")
  .option("--file <name>", "File name")
  .option("--line <n>", "Line number")
  .option("--ref <path:line>", "Task reference")
  .option("--toggle", "Toggle task status")
  .option("--done", "Mark as done")
  .option("--todo", "Mark as todo")
  .option("--status <char>", "Set status character")
  .option("--daily", "Daily note")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await task(root);
  });

// ── link ────────────────────────────────────────────────────────────

const linkCmd = program.command("link").description("Links and graph analysis");

linkCmd
  .command("out")
  .description("List outgoing links from a file")
  .option("--file <name>", "Source file")
  .option("--total", "Return link count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await links(root);
  });

linkCmd
  .command("back")
  .description("List backlinks to a file")
  .option("--file <name>", "Target file")
  .option("--counts", "Include link counts")
  .option("--total", "Return backlink count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await backlinks(root);
  });

linkCmd
  .command("unresolved")
  .description("List unresolved links in vault")
  .option("--total", "Return count")
  .option("--counts", "Include link counts")
  .option("--verbose", "Include source files")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await unresolvedLinks(root);
  });

linkCmd
  .command("orphans")
  .description("Files with no incoming links")
  .option("--total", "Return count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await orphans(root);
  });

linkCmd
  .command("deadends")
  .description("Files with no outgoing links")
  .option("--total", "Return count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await deadends(root);
  });

// ── base ────────────────────────────────────────────────────────────

const baseCmd = program
  .command("base")
  .description("Bases (database views over vault files)");

baseCmd
  .command("list")
  .description("List base files in vault")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await bases(root);
  });

baseCmd
  .command("views")
  .description("List views in a base")
  .option("--file <name>", "Base file name")
  .option("--path <path>", "Base file path")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await baseViews(root);
  });

baseCmd
  .command("query")
  .description("Query a base and return results")
  .option("--file <name>", "Base file name")
  .option("--path <path>", "Base file path")
  .option("--view <name>", "View name to query")
  .option("--format <type>", "Output format: json, csv, tsv, md, paths")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await baseQuery(root);
  });

baseCmd
  .command("create")
  .description("Create a new item in a base")
  .option("--file <name>", "Base file name")
  .option("--path <path>", "Base file path")
  .option("--name <name>", "New file name")
  .option("--content <text>", "Initial content")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await baseCreate(root);
  });

// ── canvas ──────────────────────────────────────────────────────────

const canvasCmd = program
  .command("canvas")
  .description("JSON Canvas operations");

canvasCmd
  .command("list")
  .description("List canvas files in vault")
  .option("--total", "Return count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvases(root);
  });

canvasCmd
  .command("read")
  .description("Read a canvas file")
  .option("--file <name>", "Canvas file name")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvasRead(root);
  });

canvasCmd
  .command("nodes")
  .description("List nodes in a canvas")
  .option("--file <name>", "Canvas file name")
  .option("--type <type>", "Filter by type: text, file, link, group")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvasNodes(root);
  });

canvasCmd
  .command("create")
  .description("Create an empty canvas")
  .option("--file <name>", "Canvas file name")
  .option("--path <path>", "Folder path")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvasCreate(root);
  });

canvasCmd
  .command("add-node")
  .description("Add a node to a canvas")
  .option("--file <name>", "Canvas file name")
  .option("--type <type>", "Node type: text, file, link, group")
  .option("--text <text>", "Text content (for text nodes)")
  .option("--note-file <path>", "File path (for file nodes)")
  .option("--subpath <subpath>", "Subpath (for file nodes)")
  .option("--url <url>", "URL (for link nodes)")
  .option("--label <label>", "Label (for group nodes)")
  .option("--x <n>", "X position")
  .option("--y <n>", "Y position")
  .option("--width <n>", "Width")
  .option("--height <n>", "Height")
  .option("--color <color>", "Node color (1-6 or hex)")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvasAddNode(root);
  });

canvasCmd
  .command("add-edge")
  .description("Add an edge between nodes")
  .option("--file <name>", "Canvas file name")
  .option("--from <id>", "Source node ID (or prefix)")
  .option("--to <id>", "Target node ID (or prefix)")
  .option("--from-side <side>", "Source side: top, right, bottom, left")
  .option("--to-side <side>", "Target side: top, right, bottom, left")
  .option("--label <text>", "Edge label")
  .option("--color <color>", "Edge color")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvasAddEdge(root);
  });

canvasCmd
  .command("remove-node")
  .description("Remove a node and its edges")
  .option("--file <name>", "Canvas file name")
  .option("--id <id>", "Node ID (or prefix)")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await canvasRemoveNode(root);
  });

// ── template ────────────────────────────────────────────────────────

const tmplCmd = program.command("template").description("Note templates");

tmplCmd
  .command("list")
  .description("List note templates")
  .option("--total", "Return template count")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await templates(root);
  });

tmplCmd
  .command("read")
  .description("Read template content")
  .option("--name <name>", "Template name")
  .option("--resolve", "Resolve template variables")
  .option("--title <title>", "Title for variable resolution")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await templateRead(root);
  });

tmplCmd
  .command("insert")
  .description("Insert template into a file")
  .option("--name <name>", "Template name")
  .option("--file <name>", "Target file")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await templateInsert(root);
  });

// ── bookmark ────────────────────────────────────────────────────────

const bookmarkCmd = program.command("bookmark").description("Bookmarks");

bookmarkCmd
  .command("list")
  .description("List bookmarks")
  .option("--total", "Return bookmark count")
  .option("--verbose", "Include bookmark types")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await bookmarks(root);
  });

bookmarkCmd
  .command("add")
  .description("Add a bookmark")
  .option("--file <path>", "File to bookmark")
  .option("--subpath <subpath>", "Subpath within file")
  .option("--folder <path>", "Folder to bookmark")
  .option("--search <query>", "Search query to bookmark")
  .option("--url <url>", "URL to bookmark")
  .option("--title <title>", "Bookmark title")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await bookmark(root);
  });

// ── config ──────────────────────────────────────────────────────────

const configCmd = program.command("config").description("Vault configuration");

configCmd
  .command("show")
  .description("Show current config")
  .action(async (_opts, cmd) => {
    const root = cmd.optsWithGlobals();
    await configShow(root);
  });

configCmd
  .command("get")
  .description("Get a config value")
  .option("--key <path>", "Config key (dot notation, e.g. search.limit)")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await configGet(root);
  });

configCmd
  .command("set")
  .description("Set a config value")
  .option("--key <path>", "Config key (dot notation, e.g. search.limit)")
  .option("--value <value>", "Value to set (JSON or string)")
  .action(async (opts, cmd) => {
    const root = { ...cmd.optsWithGlobals(), ...opts };
    await configSet(root);
  });

// ── copy support ────────────────────────────────────────────────────

const origWrite = process.stdout.write.bind(process.stdout);
let capturedOutput = "";

program.hook("preAction", () => {
  const opts = program.opts();
  if (opts.copy) {
    process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
      capturedOutput += chunk.toString();
      return origWrite(
        chunk,
        ...(args as [
          BufferEncoding?,
          ((err?: Error | null | undefined) => void)?,
        ]),
      );
    };
  }
});

program
  .parseAsync(process.argv)
  .then(async () => {
    const opts = program.opts();
    if (opts.copy && capturedOutput.trim()) {
      const { exec } = await import("node:child_process");
      const proc = exec("pbcopy");
      proc.stdin?.write(capturedOutput);
      proc.stdin?.end();
    }
  })
  .catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
