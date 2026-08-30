# Configuration

napkin uses a single config file at `.napkin/config.json`. CLI flags override config values. Changes sync automatically to `.obsidian/` for Obsidian compatibility.

## Commands

```bash
napkin config show                        # Show full config
napkin config get --key search.limit      # Get a specific value
napkin config set --key search.limit --value 50
```

## Reference

### overview

| Key | Default | Description |
|-----|---------|-------------|
| `overview.depth` | `3` | Max folder depth in vault map |
| `overview.keywords` | `0` | Max keywords per folder (`0` = quality-governed, no cap) |
| `overview.collapse` | `true` | Roll up numerous, lexically similar sibling folders into one row |

### search

| Key | Default | Description |
|-----|---------|-------------|
| `search.limit` | `30` | Max results returned |
| `search.snippetLines` | `0` | Context lines around matches. 0 = match-only |

### daily

| Key | Default | Description |
|-----|---------|-------------|
| `daily.folder` | `"daily"` | Folder for daily notes |
| `daily.format` | `"YYYY-MM-DD"` | Date format for daily note filenames |

### templates

| Key | Default | Description |
|-----|---------|-------------|
| `templates.folder` | `"Templates"` | Folder for note templates |

### graph

| Key | Default | Description |
|-----|---------|-------------|
| `graph.renderer` | `"auto"` | How to render the graph. `auto` uses Glimpse on macOS, browser elsewhere. `glimpse` forces native window. `browser` forces browser |

### distill

| Key | Default | Description |
|-----|---------|-------------|
| `distill.enabled` | `false` | Enable auto-distill after conversations |
| `distill.intervalMinutes` | `60` | Min interval between distill runs |
| `distill.model.provider` | `"anthropic"` | Model provider |
| `distill.model.id` | `"claude-sonnet-4-6"` | Model ID |
| `distill.templates` | `[]` | Note templates to use during distill |

## Precedence

CLI flags > `config.json` > hardcoded defaults

## File location

```
project/
  .napkin/
    config.json            # This file
    search-cache.json      # Search index cache (auto-managed)
    overview-cache.json    # Overview result cache (auto-managed)
    .obsidian/             # Auto-synced from config.json
```

The cache files are keyed by a fingerprint of vault file mtimes and rebuild
automatically; they are safe to delete at any time.

Config is created on first `napkin config set` or `napkin init`. If the file doesn't exist, defaults are used.
