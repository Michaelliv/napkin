# napkin

Local-first CLI for Obsidian vaults. Operates directly on markdown files — no Obsidian app required. Designed as a memory system for AI agents using progressive disclosure.

## Commands

```bash
bun run dev -- <command>     # Dev
bun test                     # Tests
bun run check                # Biome lint + format
```

## Architecture

- `src/main.ts` — Commander entry point, global --json/--quiet/--vault/--copy flags
- `src/commands/` — One file per command group
- `src/templates/` — Vault template definitions (coding, personal, research, company, product)
- `src/utils/output.ts` — Chalk output helpers, triple output (json/quiet/human)
- `src/utils/exit-codes.ts` — Standardized exit codes
- `src/utils/vault.ts` — Vault discovery (walks up from cwd looking for .napkin/)
- `src/utils/files.ts` — File listing, resolution (wikilink-style name or exact path)
- `src/utils/frontmatter.ts` — YAML frontmatter parse/set/remove
- `src/utils/config.ts` — Unified config (load/save/update, syncs to .obsidian/)
- `src/utils/markdown.ts` — Extract headings, tasks, tags, links from markdown
- `src/utils/search-cache.ts` — Search index cache + whole-vault mtime fingerprint
- `src/utils/overview-cache.ts` — Overview result cache (fingerprint + options key)
- `.pi/extensions/napkin-context/` — Pi extension: injects vault overview into system prompt
- `.pi/extensions/distill/` — Pi extension: auto-distills conversations into vault

## Vault Structure

`.napkin/` holds config. Content lives in the project directory:

```
project/
  .napkin/                  # napkin config + caches
    config.json             # Unified config (syncs to .obsidian/)
    search-cache.json       # Auto-managed, safe to delete
    overview-cache.json     # Auto-managed, safe to delete
  .obsidian/                # Obsidian config (auto-generated)
  NAPKIN.md                 # Level 0 context note
  decisions/                # Template-defined dirs
  architecture/
  Templates/                # Note templates
  src/                      # Project source (not in vault)
```

## Key Patterns

- **Output triple**: Every command supports `--json`, `--quiet`, and human-readable output
- **Vault auto-detect**: Walks up from cwd looking for `.napkin/` directory
- **`.napkin/` holds config + caches**: Vault content lives in the project root; `.napkin/` holds `config.json` and the auto-managed search/overview caches
- **Fingerprint caching**: search and overview cache their results keyed by vault file mtimes — any file change invalidates; caches are safe to delete
- **Search engine**: `@shift-labs/ferrosearch` — native, MiniSearch-compatible (index format included); `minisearch` remains a devDependency as the cache-migration test oracle
- **File resolution**: positional `<file>` or `--file` resolves by name (like wikilinks), `--path` requires exact path from vault root
- **No Obsidian dependency**: Pure file-system operations on markdown files
- **Progressive disclosure**: overview → search → read (4 levels, L0-L3)
- **NAPKIN.md**: Level 0 context note, rendered at top of overview
- **Templates**: `napkin init --template <name>` scaffolds vault structure + note templates

## Progressive Disclosure

| Level | Command | What it does |
|-------|---------|-------------|
| L0 | `NAPKIN.md` | Always-loaded context (rendered in overview) |
| L1 | `napkin overview` | Vault map with TF-IDF keywords per folder |
| L2 | `napkin search <query>` | BM25 + backlinks + recency ranked results with snippets |
| L3 | `napkin read <file>` | Full file content |

## Adding a New Command

1. Create `src/commands/<name>.ts`
2. Export an async function with `(args, options: OutputOptions)` signature
3. Import and register in `src/main.ts` as a Commander subcommand
4. Use the `output()` helper for triple output
5. Add tests in `src/commands/<name>.test.ts`
