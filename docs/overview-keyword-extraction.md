# Overview — Keyword Selection

The `napkin overview` command generates a vault-wide index by selecting, per
folder, the smallest set of words and phrases with which an agent both
recognizes the domain from a user request and lands in the folder by
searching them. Selection is statistical and language-agnostic — no stopword
tuning beyond the shared tokenizer, no English priors — and every candidate
is probed against the vault's own search ranking.

## Pipeline

```
Files → Tokenize per note → Group by folder → Collapse homogeneous siblings
      → Filter candidates (junk gates + statistical priors)
      → Rank by salience → Probe search routability
      → Greedy select (children claim terms before ancestors)
      → Starvation backoff (relax priors in tiers)
```

The whole pipeline runs behind an mtime-fingerprint cache (see
[Caching](#caching)); a cache hit skips everything below.

### 1. Term Sources & Weighting

Tokenization lives in `src/core/tokenizer.ts` (lowercase alpha tokens of 3+
chars, stopword-filtered, unigrams + bigrams, noise stripped first — URLs,
emails, code, HTML residue, GUID/hex/digit-blob shrapnel from converted
documents).

| Source | Weight | Title evidence | Rationale |
|--------|--------|----------------|-----------|
| Filename | 2x | yes | Chosen names are strong signals |
| Frontmatter title + values | 2x | yes | Curated metadata is title-grade |
| Headings | 2x | no | Useful, but repeated section headings are template boilerplate |
| Body text | 1x | no | Bulk content, noisier |

A heading-only term must recur across 2+ distinct heading texts or it is
rejected as a section label ("Context", "Decision").

### 2. Junk Gates (never relaxed)

- Folder-path tokens (and plural variants) — the row's path already shows them
- Machine-ID slugs: tokens with 2+ internal case humps ("haIRbrPU"); one hump
  is brand camelCase ("PostgreSQL") and passes
- Near-vowelless blobs ("jsknwoxz") unless the word recurs in 3+ notes
- Degenerate bigrams ("meridian meridian", near-duplicate pairs)

### 3. Statistical Priors (relaxed in tiers when a row starves)

- **Vault-common**: terms in more than ~12% of the notes *outside the
  folder* (floor of 3 in tiny vaults) cannot discriminate any domain —
  measured externally so a dominant folder (80% of the vault) is not banned
  from its own recurring vocabulary
- **df/tf floors**: a keyword must recur, unless it is title-backed — in
  one-note-per-entity folders each name appears exactly once, in its filename
- **Template boilerplate**: present in most notes of a big folder but only
  ~once per note; real recurring entities repeat within notes
- **Non-domain words**: dispersed vault-wide, never in note names at a rate
  matching their commonness, and not concentrated in this folder beyond what
  its size predicts — catches speech verbs and hedge words in any language.
  Only real note names (filename or `title:` property) certify a word as
  domain vocabulary; arbitrary frontmatter values ("captured: Jul 14") do
  not. A word with no name evidence anywhere needs near-total concentration
  (≥ 0.85) to survive — "tedious" (the MSSQL library, concentrated in
  procedures/) passes; "him" (leaning toward people/) does not. The
  concentration bar is capped at 0.9 so it stays attainable in
  dominant-folder vaults
- **Genre words**: in big folders, a keyword must be a title word somewhere
  or bursty ("payroll" clusters; "silently" is shared writing style)

### 4. Salience & Routability

Candidates are ranked by
`concentration^0.3 × log(1+tf) × burstiness^0.7 × √log(1+df) × titleBoost`,
with recurring bigrams promoted above unigrams that mostly live inside them
("visit" → "reference visit"). Each candidate is then probed against the
shared search corpus (`loadSearchCorpus` — the exact ranking `napkin search`
uses): precision of its top results landing in the folder, alone or composed
with the folder's anchor token ("meridian msa"). Routability is a soft bonus,
not a veto — agents can scope searches with `--path`.

### 5. Selection

Greedy maximization of `salience × coverage-diversity × (0.35 + precision)`
with lexical-overlap suppression (plural and near-duplicate variants count as
the same word). Folders are processed deepest-first: children claim their
terms, so ancestor rows must contribute information not already visible on a
descendant row.

There is no count budget — depth is governed by quality: every term above
the quality bar is shown, because an agent must know which search words
exist. Two quality readings, and the higher one governs:

- **Vault-wide quality bar**: selection runs twice; pass 1 measures every
  row's best gain, and the median calibrates one absolute notion of "good"
  for the whole vault. A row with weak vocabulary stops early instead of
  padding a flat plateau; a row with 100 strong entity terms shows all 100
- **Relative floor**: 15% of the row's k-th best gain — not its maximum, so
  a single outlier head term cannot cut off a deep domain; catches rows
  whose weak tail still clears a low vault bar

Marginal coverage is a soft preference, never a veto: probes see only the
top-10 results, so a genuine domain term can re-hit covered notes by
accident — and the agent still needs to know the word exists.

A starved row (< 4 keywords) relaxes the statistical priors tier by tier and
refills — sparse vaults show their once-mentioned vocabulary rather than
nothing. `overview.keywords` remains as a manual cap (default 0 = uncapped).

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

### 8. Topic Decomposition

Multi-topic folders (procedure libraries, meeting dumps, incident logs) are
mixtures, and a flat term list destroys the structure an agent routes by.
Rows with ≥ 8 notes decompose into topics:

- **Heads are name-backed**: a topic label is a phrase people actually title
  notes with (folder nameDf ≥ max(2, 4% of notes)) — curated evidence, with
  the longest phrase naming mostly the same notes winning ("bakery" →
  "night bakery")
- **Membership is content-grounded**: a note belongs to a topic it mentions
  in its title or discusses in its body (tf ≥ 2) — counts reflect what notes
  are about, not what they are called
- **Ubiquity ban**: a term strongly present in most folders (median folder
  share ≥ 0.5) is an operator or company name — vault furniture, not a topic
  (measured on real vaults, an operator's first name sits at median 0.79
  while a true product-line topic stays near 0.3 even in the vault dedicated
  to it)
- **Greedy set cover**: each topic must explain ≥ max(3, 4%) notes no
  earlier topic covers; a topic swallowing > 60% of the row is the folder's
  genre, not a subtopic
- Selected keywords whose notes live inside a topic become its refining
  terms; the rest stay as the row's cross-topic `keywords:` line

```
procedures/ — 127 notes
  · night bakery (39): holiday, harvest forecast, stockout, recommendation
  · traceability (17): traceability recall, ocr, intake sharepoint, receipts
  keywords: microsoftmail, node, runline, …
```

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
| `--keywords <n>` | 0 | Max keywords per folder (0 = quality-governed, no cap) |
| `--depth <n>` | 3 | Max folder depth to index |
| `--no-collapse` | collapse on | Disable homogeneous-sibling collapse |

## Evaluation

`bench/overview-exposure.ts` scores the selected keywords per folder against
the vault's own search ranking (precision: do a keyword's top results land in
its folder; coverage: how many of the folder's notes at least one keyword
reaches). `bench/exposure-all.sh` runs it across every KB in `data-kbs/`.

## Example

```
Customers/Meridian/Meetings/
  keywords: return analysis, dana arbel, exhibit, noa peretz, msa redline, negotiation, clause
  notes: 11
```

People, deals, and artifacts distinctive to the folder surface; vault-wide
vocabulary ("crm", "meeting", the operator's name) is suppressed because it
cannot route anywhere.
