---
name: tend
description: >
  Keep a napkin vault healthy: fix broken links, reconnect or retire forgotten
  notes, merge duplicates, tame tag sprawl, and propose templates for recurring
  note shapes. Use when the user says "tend the vault", "clean up the vault",
  "prune my notes", or on a periodic schedule. Conservative by design — small
  fixes each run, deletions go to .trash, structural changes are proposed, not
  imposed. Requires the napkin CLI.
---

# Tend — Vault Upkeep

You are tending a napkin vault. Knowledge bases rot by appending: links break,
duplicates accumulate, tags sprawl, notes get orphaned. Tend reverses a little
of that each run.

**Disposition: gardener, not bulldozer.** Fix a handful of things well, then
stop. When unsure, do nothing — a wrong merge loses knowledge, a skipped one
costs nothing. This skill is safe to run on a schedule precisely because its
default answer is "nothing needs doing."

## Step 1: Inspect

```bash
napkin overview --json           # folder map; collapsed folders = dump-shaped mess
napkin link unresolved --json    # broken wikilinks
napkin link orphans --json       # notes nothing points to
napkin tag list --counts --json  # tag sprawl: singletons, near-duplicate names
```

If everything is clean, say so and stop. That is the expected common case.

## Step 2: Pick at most 3–5 issues

Priority order — cheap and safe first:

1. **Broken links.** Usually a typo or a renamed note. Fix the link to point at
   the right note (`napkin search "<target>" --json` to find it). If the target
   genuinely never existed and the mention doesn't merit a note, unlink the text.
2. **Tag variants.** `postgres` vs `postgresql`, `auth` vs `authentication` —
   pick the more-used form and update the others via `napkin read` +
   `napkin create --overwrite`. Leave meaningful singletons alone; a tag used
   once is not automatically wrong.
3. **Orphans.** Read the note. If it's still valuable, link it from the most
   related note (found via search). If it's an empty stub or superseded,
   `napkin delete` it — deletion moves to `.trash`, never permanent.
4. **Duplicates.** When search for a topic returns two notes covering the same
   subject: read both, merge into the better-named one (integrate, don't
   concatenate), `napkin delete` the other, then fix any links that pointed to
   it (`napkin link back --file "<loser>"` before deleting tells you which).
   Only merge when the overlap is obvious from reading — similarity of vibe is
   not enough.
5. **Misfiled notes.** A note whose topic clearly belongs in another
   template-defined folder: `napkin move`. Skip when it's arguable.

Cap the run. Leftover issues will still be there next time — that's the point
of running periodically.

## Step 3: Notice missing templates (observation only)

While reading notes, if you see **3+ notes in one folder sharing the same
improvised structure** and no matching entry in `napkin template list`, that's
a template wanting to exist. Compare shapes deterministically:

```bash
napkin file outline "<note>" --format json   # heading structure per note
```

Don't create the template — report it:

```
Template candidate: guides/ has 4 notes shaped Problem/Fix/Gotcha
with no matching template. Create "Troubleshooting"?
```

The user decides. Templates are the vault's schema; schema changes are theirs.

## Step 4: Verify and report

```bash
napkin link unresolved --json    # your edits must not have broken anything
```

Report what changed, one line each, and what was left for next time:

```
Tended the vault:
  fixed 2 broken links (Deploy Guide, CI Setup)
  merged "Postgres Pooling" into "Postgres Connection Pooling" (loser in .trash)
  left for later: 3 orphans in research/, tag variants auth/authentication
Template candidate: guides/ → "Troubleshooting" (4 similarly-shaped notes)
```

If `NAPKIN.md` mentions anything the tending made untrue (renamed or deleted
notes), update it.
