# Agent Memory System — Progressive Disclosure

> napkin as a structured memory system for AI agents, built on progressive disclosure.

## Core Idea

Agents work best when information is revealed gradually rather than dumped all at once. Instead of vector search, we use a four-level disclosure model (Levels 0–3) that respects context windows and gives agents control over how deep they go.

## Levels of Disclosure

### Level 0 — Pinned Context
A small "always loaded" note the agent reads on every session. Like CLAUDE.md but for the knowledge base. Contains project goals, conventions, key decisions. Should fit in ~500 tokens.

### Level 1 — Overview Map
A generated index of the entire vault. Directory tree with search-validated domain keywords per folder — the words an agent can actually search to land in that folder. Gives the agent orientation — a table of contents for the vault. Target: ~1-2K tokens max. Tags are available in `--json` but excluded from the primer: they cost tokens without carrying routing signal.

Example output:
```
projects/
  keywords: roadmap, Q2, launch, pricing
  notes: 4
projects/napkin/
  keywords: CLI, obsidian, markdown, agent, memory
  notes: 7
people/
  keywords: hiring, team, 1on1
  notes: 12
```

### Level 2 — Search with Snippets
Agent searches using keywords from the overview. Results return partial content — matched keywords highlighted with a context window (~3 lines) around each match. Never full files.

Ranking signals:
- **BM25** — term frequency / inverse document frequency
- **PageRank via backlinks** — notes with more inbound links rank higher (Obsidian link graph is a natural fit)
- **Recency** — file mtime as a tiebreaker

Example output:
```
projects/napkin/architecture.md (score: 8.2, links: 5, modified: 2d ago)
  L14: ...the CLI operates on **markdown files** directly, no Obsidian app...
  L42: ...progressive disclosure model with three **levels** of detail...

daily/2026-03-13.md (score: 6.1, links: 1, modified: 2d ago)
  L8: ...discussed **memory** system design with the team...
```

### Level 3 — Read
Open and read full files. Already implemented via `napkin read`.

## Templates

Different domains need different vault structures AND different Level 1 overviews.

### Coding Project Template
```
decisions/       # ADRs
architecture/    # System design docs
bugs/            # Bug reports / investigations
changelog/       # Release notes
```
Overview extracts: file paths, function/module names, decision statuses.

### Personal Assistant Template
```
people/          # Contact notes
projects/        # Active projects
areas/           # Life areas (health, finance, etc.)
daily/           # Daily notes
```
Overview extracts: people names, dates, project statuses.

### Research Template
```
papers/          # Paper notes
concepts/        # Key ideas
questions/       # Open questions
experiments/     # Results and logs
```
Overview extracts: paper titles, key findings, open questions.

Templates define:
1. Directory structure
2. Starter notes / frontmatter schemas
3. What the overview index extracts (configurable keyword sources)
4. Recommended bases for structured views

## Auto-Distillation

Two mechanisms for keeping the knowledge base compact and useful:

### Summarization
Compress verbose content into shorter forms:
- Daily notes → weekly summaries → monthly summaries
- Long meeting notes → key decisions + action items
- Verbose logs → extracted insights

Implemented as a command (`napkin distill`) that:
1. Reads source content
2. Outputs it in a format for the calling agent/LLM to compress
3. Writes the summary back to a target note
4. Optionally archives the originals

No background daemon — the agent decides when to distill. Fits local-first philosophy.

### Promotion
Track access/search patterns. When info is referenced frequently:
- Bubble key facts into the Level 1 overview
- Create or update a "key facts" pinned note
- This is tractable without an LLM — just count access patterns

## Implementation Order

1. `napkin overview` — generate Level 1 index
2. `napkin search` upgrade — BM25, snippets, backlink ranking
3. `napkin init --template <name>` — domain-specific scaffolding
4. `napkin distill` — summarization hooks

## Design Principles

- **Local-first**: Everything operates on files, no servers or daemons
- **Obsidian-compatible**: All generated files are valid Obsidian vault content
- **Agent-driven**: The agent decides when to go deeper, when to distill, when to search
- **Token-conscious**: Every level is designed with context window budgets in mind
- **No vectors**: BM25 + link graph + recency > embeddings for structured knowledge bases
