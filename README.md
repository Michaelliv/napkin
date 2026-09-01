# napkin

🧻 Knowledge system for agents. Local-first, file-based, progressively disclosed.

Every great idea started on a napkin.

```bash
npm install -g @shiftlabs/napkin
```

Search runs on [ferrosearch](https://github.com/shift-labs-ai/ferrosearch),
a native MiniSearch-compatible engine with prebuilt binaries for macOS
(arm64, x64) and Linux (x64, arm64, glibc and musl). Other platforms build
it from source with Rust installed.

---

## Quick Start

```bash
# Initialize a vault
napkin init --template coding

# See what's in it
napkin overview

# Search for something
napkin search "authentication"

# Read a file
napkin read "Architecture"

# Update the CLI
napkin update

# Write
napkin create "Decision" --template Decision
napkin append "Decision" "We chose Postgres."
napkin daily append "- [ ] Review PR"
```

---

## SDK

napkin is also a library. No CLI, no stdout - just data:

```typescript
import { Napkin } from "@shiftlabs/napkin";

// Always works - creates bare vault if needed
const n = new Napkin("/path/to/project");

// Progressive disclosure
const overview = n.overview();
const results = n.search("authentication");
const file = n.read("Architecture");

// Write
n.create({ name: "New Note", content: "# Hello" });
n.append("New Note", "\nMore content");

// Daily notes
n.dailyEnsure();
n.dailyAppend("- Met with team");

// Everything else
n.tags();
n.tasks({ todo: true });
n.linksBack("Architecture");
n.outline("Architecture");
n.properties();
n.bookmarks();
n.config();
```

Scaffold with a template:

```typescript
Napkin.scaffold("/path/to/project", { template: "coding" });
Napkin.vaultTemplates(); // list available templates
```

### Config in code

Pass a config and the instance takes every setting from it — including the
vault layout. `.napkin/config.json` is never read on any of its code paths, so
a value stored in a vault years ago cannot outrank the one your source says
today:

```typescript
import {
  Napkin,
  DEFAULT_CONFIG,
  SIBLING_VAULT_LAYOUT,
  type NapkinConfig,
} from "@shiftlabs/napkin";

const CONFIG: NapkinConfig = {
  ...DEFAULT_CONFIG,
  overview: { depth: 3, keywords: 0, collapse: true },
  vault: SIBLING_VAULT_LAYOUT,
};

const n = new Napkin("/path/to/project", { config: CONFIG });
n.overview();                  // uses CONFIG
n.overview({ depth: 1 });      // per-call options still win, per field
n.configSet("overview.depth", "1"); // throws: the source owns this
```

The object is copied and frozen at construction. Without the option nothing
changes: the vault's config.json is read as before.

All SDK methods return typed data and throw errors on failure. No `console.log`, no `process.exit`.

---

## Progressive Disclosure

napkin is designed as a memory system for agents. Instead of dumping the full vault into context, it reveals information gradually:

| Level | Command | Tokens | What it does |
|-------|---------|--------|-------------|
| 0 | `NAPKIN.md` | ~200 | Project context note |
| 1 | `napkin overview` | ~1-2k | L0 + vault map with search-validated keywords |
| 2 | `napkin search <query>` | ~2-5k | Ranked results with snippets |
| 3 | `napkin read <file>` | ~5-20k | Full file content |

## Benchmarks

napkin includes agentic retrieval benchmarks in `bench/`. The headline result is [LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025), which tests long-term conversational memory across 500 questions.

| Dataset | Sessions | pi + napkin | Best prior system | GPT-4o full context |
|---------|----------|-------------|-------------------|---------------------|
| Oracle | 1-6 | **92.0%** | 92.4% | 92.4% |
| S | ~40 | **91.0%** | 86% | 64% |
| M | ~500 | **83.0%** | 72% | n/a |

Zero preprocessing. No embeddings, no graphs, no summaries. Just BM25 search on markdown files.

See [`bench/README.md`](bench/README.md) for details and usage.

---

## Vault Structure

`.napkin/` holds config. Content lives in the project directory alongside `.obsidian/`:

```
my-project/
  .napkin/                  # napkin config + caches
    config.json             # Unified config (syncs to .obsidian/)
    *-cache.json            # Search/overview caches (auto-managed)
  .obsidian/                # Obsidian config (auto-generated)
  NAPKIN.md                 # Context note (Level 0)
  decisions/                # Template-defined directories
  architecture/
  Templates/                # Note templates
  src/                      # Your project (not in vault)
```

## Templates

Scaffold a vault with a domain-specific structure:

```bash
napkin init --template coding    # decisions/, architecture/, guides/, changelog/
napkin init --template company   # people/, projects/, runbooks/, infrastructure/
napkin init --template product   # features/, roadmap/, research/, specs/, releases/
napkin init --template personal  # people/, projects/, areas/, references/
napkin init --template research  # papers/, concepts/, questions/, experiments/
```

Each template includes directory structure, `_about.md` files, Obsidian note templates, and a `NAPKIN.md` skeleton.

---

## For Agents

Every command supports `--json` for structured output and `-q` for raw output:

```bash
napkin overview --json          # Structured vault map
napkin search "auth" --json     # Ranked results as JSON
napkin read "Note" -q           # Raw markdown, nothing else
```

The package ships two agent skills in `skills/` — **distill** (turn a working
session into vault notes: gate, dedup via search, merge over create) and
**tend** (periodic upkeep: broken links, orphans, duplicates, tag sprawl).
Point your agent's skill loader at them or copy them into its skills directory.

---

## CLI Reference

### Global Flags

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `-q, --quiet` | Suppress output |
| `--vault <path>` | Vault path (default: auto-detect from cwd) |
| `--copy` | Copy output to clipboard |

### Core

```bash
napkin vault                          # Vault info
napkin overview                       # Vault map with keywords
napkin update                         # Update the napkin CLI
napkin read <file>                    # Read file contents
napkin create "Note" $'# Hello\nFirst note.'   # Create with content
napkin append "Note" $'\n## Update\nNew info.'   # Append to file
napkin prepend "Note" $'---\ntags: [new]\n---'   # Prepend frontmatter
napkin move "Note" Archive            # Move to folder
napkin rename "Note" "Renamed"        # Rename file
napkin delete "Note"                  # Move to .trash
napkin search "meeting"               # Ranked search with snippets
napkin search "TODO" --no-snippets    # Files only
echo "piped content" | napkin append "Note"  # Stdin support
```

### Files & Folders - `napkin file`

```bash
napkin file info <name>               # File info (path, size, dates)
napkin file list                      # List all files
napkin file list --ext md             # Filter by extension
napkin file list --folder Projects    # Filter by folder
napkin file folder <path>             # Folder info
napkin file folders                   # List all folders
napkin file outline "note"            # Heading tree
napkin file wordcount "note"          # Word + character count
```

### Daily Notes - `napkin daily`

```bash
napkin daily today                    # Create today's daily note
napkin daily path                     # Print daily note path
napkin daily read                     # Print daily note contents
napkin daily append "- [ ] Buy groceries"
napkin daily prepend "## Morning"
```

### Tags - `napkin tag`

```bash
napkin tag list                       # List all tags
napkin tag list --counts              # With occurrence counts
napkin tag list --sort count          # Sort by frequency
napkin tag info --name "project"      # Tag info
napkin tag aliases                    # List all aliases
```

### Properties - `napkin property`

```bash
napkin property list                  # List all properties
napkin property list --file "note"    # Properties for a file
napkin property read --file "note" --name title
napkin property set --file "note" --name status --value done
napkin property remove --file "note" --name status
```

### Tasks - `napkin task`

```bash
napkin task list                      # List all tasks
napkin task list --todo               # Incomplete only
napkin task list --done               # Completed only
napkin task list --daily              # Today's daily note tasks
napkin task show --file "note" --line 3 --toggle
```

### Links - `napkin link`

```bash
napkin link out --file "note"         # Outgoing links
napkin link back --file "note"        # Backlinks
napkin link unresolved                # Broken links
napkin link orphans                   # No incoming links
napkin link deadends                  # No outgoing links
```

### Bases - `napkin base`

```bash
napkin base list                      # List .base files
napkin base views --file "projects"   # List views
napkin base query --file "projects"   # Query default view
napkin base query --file "projects" --view "Active" --format csv
napkin base create --file "projects" --name "New Item"
```

### Canvas - `napkin canvas`

```bash
napkin canvas list                    # List .canvas files
napkin canvas read --file "Board"     # Dump canvas
napkin canvas nodes --file "Board"    # List nodes
napkin canvas create --file "Board"   # Create empty canvas
napkin canvas add-node --file "Board" --type text --text "# Hello"
napkin canvas add-edge --file "Board" --from abc1 --to def2
napkin canvas remove-node --file "Board" --id abc1
```

### Templates - `napkin template`

```bash
napkin template list                  # List note templates
napkin template read --name "Daily Note"
napkin template insert --file "note" --name "Template"
```

### Bookmarks - `napkin bookmark`

```bash
napkin bookmark list                  # List bookmarks
napkin bookmark add --file "note"     # Bookmark a file
```

### Config - `napkin config`

```bash
napkin config show                    # Show full config
napkin config get --key search.limit  # Get a value
napkin config set --key search.limit --value 50
```

### Graph - `napkin graph`

```bash
napkin graph                          # Interactive vault graph
```

Force-directed graph of vault notes and wikilinks. Click nodes to read content in a sidebar.

---

## File Resolution

Files can be referenced two ways:
- **By name** (wikilink-style): `"Active Projects"` - searches all `.md` files by basename
- **By path**: `"Projects/Active Projects.md"` - exact path from vault root

---

## Architecture

```
src/
  index.ts       # SDK exports: Napkin class + all types
  sdk.ts         # Napkin class wrapping core modules
  main.ts        # CLI entry (Commander) - thin wrapper
  core/          # Pure logic, returns data, no stdout
  commands/      # CLI wrappers: parse args → sdk → format + print
  utils/         # Shared utilities (files, frontmatter, markdown, etc.)
```

Core modules never call `console.log`, `process.exit`, or import output utilities. They return typed data and throw errors. The CLI commands are thin wrappers that instantiate the SDK, call methods, and format the output.

---

## Pi Integration

For [pi](https://github.com/badlogic/pi-mono) users, install [pi-napkin](https://github.com/Michaelliv/pi-napkin) — vault context injection, `kb_search`/`kb_read` tools, and automatic distillation.

```bash
pi install npm:pi-napkin
```

---

## Development

```bash
bun install
bun run dev -- vault --json
bun test
bun run check
```

## License

MIT
