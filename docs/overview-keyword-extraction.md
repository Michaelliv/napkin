# Overview — The Index Core

The `napkin overview` command renders the vault as an index: every folder
row lists handles — words and phrases an agent can search to reach the
folder's notes. Selection is per note, statistical, and language-agnostic —
no stopword tuning beyond the shared tokenizer, no English priors — and
every handle is probed against the vault's own search ranking.

The governing idea: treat each note as a document in a search engine. The
terms that would score highest for that note under BM25 — its top tf × idf
terms — are its **retrieval fingerprint**: the tokens someone would type to
get that note back. A folder row is the union of its notes' fingerprints,
minus the vault's common vocabulary.

## Pipeline

```
Files → Tokenize per note → Group by folder → Collapse homogeneous siblings
      → Per-note fingerprints (tf × idf, title handles boosted)
      → Subtract KB-common terms + junk gates
      → Probe-validate each handle against the search index
      → Credit shared handles / complete entity rosters
```

The whole pipeline runs behind an mtime-fingerprint cache (see
[Caching](#caching)); a cache hit skips everything below.

### 1. Term Sources & Weighting

Tokenization lives in `src/core/tokenizer.ts` (lowercase alpha tokens of 3+
chars, stopword-filtered, unigrams + bigrams, noise stripped first — URLs,
emails, code, HTML residue, GUID/hex/digit-blob shrapnel from converted
documents).

| Source | Weight | Naming evidence | Rationale |
|--------|--------|-----------------|-----------|
| Filename | 2x | yes | Chosen names are strong signals |
| Frontmatter `title:` | 2x | yes | Curated metadata is title-grade |
| Frontmatter values | 2x | no | Indexed, but "captured: Jul 14" names nothing |
| Headings | 2x (folder stats only) | no | Repeated section headings are template boilerplate |
| Body text | 1x | no | Bulk content, noisier |

Heading terms feed folder statistics (document frequency, collapse
similarity) but never enter a note's fingerprint candidates — a section
label ("Context", "Decision") is structure, not content.

### 2. Junk Gates

- Folder-path tokens (and plural variants) — the row's path already shows them
- Machine-ID slugs: tokens with 2+ internal case humps ("haIRbrPU"); one hump
  is brand camelCase ("PostgreSQL") and passes
- Near-vowelless blobs ("jsknwoxz") unless the word recurs in 3+ notes
- Degenerate bigrams ("meridian meridian", near-duplicate pairs)

### 3. The KB-Common Subtraction

A term present in more than 15% of the notes **outside the candidate
folder** is vault furniture ("agent", "user" on an agent-platform vault) —
it discriminates nothing and cannot be anybody's fingerprint. Measured
outside the folder so a dominant folder (80% of the vault) still owns its
own recurring vocabulary. Two escapes:

- **Scale floor**: below 5 outside-the-folder notes a term cannot be
  common — tiny vaults, where the domain itself is in every note, keep
  their vocabulary
- **Title evidence**: a term multiple notes are *named* with ("schedule",
  "sensor") survives up to 2× the bar; nothing rescues a word in half the
  vault, however many titles carry it

### 4. Fingerprints, Probes, and Handles

Each note proposes its top candidates by `log(1+tf) × idf`, with the note's
own name terms boosted (×2.5 for title phrases, ×1.8 for title words) — a
note's curated name is its handle; body tokens are the fallback. Without
the boost, a rare body unigram ("dip") outbids the note's own title bigram
("salad orders"): routable but mute.

**Fingerprint proposes, probe disposes**: candidates are fired at the
shared search corpus (`loadSearchCorpus` — the exact ranking `napkin
search` uses), and the first whose top-3 hits include the note itself
becomes the handle. When none validates, the best fingerprint still
represents the note — an unroutable handle beats invisibility.

Before choosing, a note reachable through an already-chosen handle (probed,
never assumed) credits that handle instead of adding a synonym — shared
handles accumulate note counts (`keywordNotes` in `--json`) and sort first:
they are the row's de-facto domains. Word-set identity ("rows cols" ≡
"cols rows", "grape" ≡ "grapes") and near-duplicate OCR variants
("komplet" ≈ "complet") deduplicate the row.

### 5. Rosters

Full 1–2-token note titles ("gong", "ilia kesler") are curated handles by
definition: one-note-per-entity folders list their entities. Roster titles
are exempt from the KB-common subtraction in their home folder — an
entity's home row shows its name however widely the entity is discussed
elsewhere — and roster-titled notes skip body fingerprinting: a person
note's body is episode, not identity.

A digit-bearing basename that tokenizes to a single word ("vex-0.14" →
"vex") lost its identity to the tokenizer and takes the fingerprint path
instead; two surviving tokens ("soc2-readiness" → "soc readiness") still
carry the identity.

Folders are processed deepest-first: children claim their terms, so
ancestor rows must contribute information not already visible on a
descendant row. `overview.keywords` remains as a manual cap (default 0 =
uncapped); collapsed rows cap their index at 16 — their `contains:` roster
is the real index.

### 6. Homogeneous-Sibling Collapse

Parents with 5+ children whose body-term distributions are lexically similar
(mean pairwise cosine ≥ 0.15 over top terms) are rendered as one aggregate
row — `imports/ (+6 similar subfolders)` — so imported document dumps don't
drown the overview. Similarity uses body text only, so shared filename
conventions cannot fake content homogeneity. Top-level folders never collapse
into the root. Disable with `--no-collapse`.

Collapsed rows list their children (`contains: meridian, northwind, bluepine, …`,
largest first, capped at 12): child folder names are curated entity labels —
the roster is often the most valuable index a collapsed row can show, and it
works even for names the tokenizer cannot index (Hebrew folder names).

### 7. Curated Descriptions

A folder's `_about.md` stays out of keyword statistics but describes the
row. The explicit contract is a `description:` frontmatter property, used
verbatim. Files without it fall back to the first prose paragraph
(hard-wrapped lines joined), capped at 140 chars on a word boundary —
curated beats derived wherever a human or agent has written one.

## Caching

The final result is cached in `.napkin/overview-cache.json`, keyed by a
whole-vault fingerprint (file paths + mtimes, `src/utils/fingerprint.ts`)
plus the resolved options and an algorithm version. Any file add, remove, or
touch — including `NAPKIN.md` — invalidates it; so does changing `depth`,
`keywords`, or `collapse`. The search-probe corpus shares the search cache,
so a cold overview also warms `napkin search`. Corrupt cache files are
ignored and rebuilt.

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--keywords <n>` | 0 | Max keywords per folder (0 = one handle per note, deduplicated) |
| `--depth <n>` | 3 | Max folder depth to index |
| `--no-collapse` | collapse on | Disable homogeneous-sibling collapse |

## Evaluation

`bench/overview-exposure.ts` scores the selected keywords per folder against
the vault's own search ranking (precision: do a keyword's top results land in
its folder; coverage: how many of the folder's notes at least one keyword
reaches). `bench/exposure-all.sh` runs it across every KB in `data-kbs/`.
The index core's contract is coverage: every note reachable through at
least one displayed handle.

## Example

```
procedures/
  keywords: recall drill, customer notification, thursday dispatch, salad orders,
            forecast actuals, bakery benchmark, staff performance, sap allergen, …
  notes: 127
```

Every procedure surfaces its own handle — the row reads as a catalog of
what the agent can do. Vault-wide vocabulary ("crm", "meeting", the
operator's name) is subtracted because it cannot route anywhere.
