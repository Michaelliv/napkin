# Overview — Keyword Extraction

The `napkin overview` command generates a vault-wide index by extracting distinctive keywords per folder using TF-IDF with source weighting and bigram support.

## Pipeline

```
Files → Group by folder → Collect weighted text → Build TF → Collapse homogeneous siblings → Compute IDF across folders → Score TF-IDF → Deduplicate bigrams → Top N keywords
```

The whole pipeline runs behind an mtime-fingerprint cache (see
[Caching](#caching)); a cache hit skips everything below.

### 1. Text Collection & Weighting

Not all text is equal. Sources are weighted by signal strength:

| Source | Weight | Rationale |
|--------|--------|-----------|
| Headings | 3x | Curated by the author, high intent |
| Filenames | 2x | Chosen names are strong signals |
| Frontmatter title | 2x | Explicit metadata |
| Other frontmatter values | 2x | Explicit metadata (wikilink-only and date values excluded) |
| Body text | 1x | Bulk content, noisier |

### 2. Noise Stripping

Before tokenization, we strip:
- URLs (`https://...`) and emails
- Code blocks (fenced and inline)
- HTML tags and entities (residue of converted documents)
- Hex hashes (commit SHAs), dashed GUIDs (`AAAA1111-2222-...`), and
  mixed-digit blobs (`INV20240915X`) — ID shrapnel from OCR'd PDFs and
  DocuSign-style exports that would otherwise pollute keywords

Each pattern only runs when a cheap necessary condition holds (an email
needs `@`, a URL needs `http`), so clean prose skips the regex scans.

### 3. Tokenization

- Lowercase, alpha-only, 3+ characters
- Filtered against a stop word list (~120 common English words)

### 4. Bigram Extraction

Two-word phrases are extracted alongside unigrams. Bigrams are kept only if:
- They appear **2+ times** in the folder (otherwise likely noise)
- The two words are **not identical** (filters "tbd tbd" type garbage)

### 5. Homogeneous-Sibling Collapse

Parents with 5+ children whose body-term distributions are lexically
similar (mean pairwise cosine ≥ 0.15 over top terms) are rendered as one
aggregate row — `imports/ (+6 similar subfolders)` — so imported document
dumps don't drown the overview. Similarity uses body text only, so shared
filename conventions cannot fake content homogeneity. Top-level folders
never collapse into the root. Disable with `--no-collapse`.

### 6. TF-IDF Scoring

Each folder is treated as a "document":

- **TF** = weighted term frequency within the folder
- **IDF** = `log(1 + totalFolders / foldersContainingTerm)`

The `1 +` dampening prevents over-penalizing terms that appear in a few folders. A word in 3 out of 9 folders still gets reasonable weight, while a word in all 9 gets suppressed.

Candidates are also filtered for corroboration — a term must appear outside
headings or in 2+ heading lines (single heading-only terms are usually
section labels like "Notes") — and terms matching the folder's own name
(including singular/plural variants) are excluded as redundant.

### 7. Bigram Deduplication

When a bigram is selected (e.g., "knowledge base"), its constituent unigrams ("knowledge", "base") are suppressed from the results. This prevents redundant keyword slots.

## Caching

The final result is cached in `.napkin/overview-cache.json`, keyed by a
whole-vault fingerprint (file paths + mtimes) plus the resolved options.
Any file add, remove, or touch — including `NAPKIN.md` — invalidates it;
so does changing `depth`, `keywords`, or `collapse`. A cache hit costs one
stat pass instead of reading and tokenizing every note (~25ms vs ~1s on a
5,000-note vault). Corrupt cache files are ignored and rebuilt.

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--keywords <n>` | 8 | Max keywords per folder |
| `--depth <n>` | 3 | Max folder depth to index |
| `--no-collapse` | collapse on | Disable homogeneous-sibling collapse |

## Example

```
Resources/Runbooks/
  keywords: remote, vercel, context, runbook, auth, handoff, rule, pipeline
  notes: 6
```

"runbook" appears here because it's distinctive to this folder (high IDF), while "notes" — which appears in every folder — is suppressed.
