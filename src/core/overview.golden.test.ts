import { afterAll, describe, expect, test } from "bun:test";
import { createTempVault } from "../utils/test-helpers.js";
import { getOverview } from "./overview.js";

/**
 * Characterization (golden) test for getOverview.
 *
 * The fixture vault deterministically exercises every code path in
 * overview.ts: weighted TF sources (filename x2, title x2, frontmatter x2,
 * body x1, headings x3), heading dedup across files, heading corroboration
 * filtering, bigram extraction + unigram suppression, folder-token exclusion
 * (singular/plural), noise stripping (code, URLs, emails, HTML, GUIDs, digit
 * blobs, hex runs), scaffold skipping (Templates/, NAPKIN.md, _about.md),
 * depth limiting, malformed-frontmatter warnings, homogeneous-sibling
 * collapse, and heterogeneous siblings kept separate.
 *
 * Any behavior change in the overview pipeline must show up as a snapshot
 * diff. Performance refactors must keep this snapshot byte-identical.
 */

const FIXTURE: Record<string, string> = {
  // L0 context — rendered separately, excluded from folder rows
  "NAPKIN.md": "# Fixture project\nContext note for the golden vault.",
  // scaffold files — always skipped
  "Templates/Decision.md": "# {{title}}\n## Context\n## Decision",
  "decisions/_about.md": "# Decisions\nArchitecture Decision Records.",

  // root-level note
  "welcome.md": "# Welcome\nOrientation for newcomers to the fixture vault.",

  // decisions/: repeated structural headings (Context/Decision/Consequences
  // must be suppressed), bigrams, distinctive unigrams
  "decisions/postgres.md": `---
title: Use PostgreSQL
tags: [database, adr]
status: accepted
date: 2024-03-01
related: "[[outbox]]"
---
# Use PostgreSQL
## Context
Ledger writes need transactional storage with strict durability.
## Decision
Use PostgreSQL for balances and ledger entries. Connection pooling via pgbouncer.
## Consequences
We operate backups and vacuum schedules ourselves.`,
  "decisions/outbox.md": `---
title: Adopt transactional outbox
tags: [messaging]
---
# Adopt transactional outbox
## Context
Kafka dual writes lost events during broker failover.
## Decision
Write outbox events inside the database transaction, relay them asynchronously.
## Consequences
Relay latency increases slightly. Transactional outbox rows need pruning.`,
  "decisions/braintree.md": `# Deprecate Braintree
## Context
Braintree maintenance cost is high and the SDK is stale.
## Decision
Migrate merchants to Adyen over two quarters.
## Consequences
Two merchants need bespoke migration plans.`,

  // contracts/: converted-document noise that must never leak into keywords
  "contracts/lease.md": `# Lease agreement
DocuSign Envelope ID: AAAA1111-2222-4333-ADAB-BCF123456789
<div align="center">&nbsp;</div>
Tenant leases the third floor at https://example.com/portal?id=99 and pays
rent monthly. Contact leasing@example.com with hash deadbeefcafe1234.
Sublease requires landlord approval and a bank guarantee. Code \`rentCalc()\`
and block:
\`\`\`js
const rent = base * 1.05; // escalation
\`\`\`
Reference ab12cd34ef and invoice INV20240915X for the guarantee.`,
  "contracts/parking.md": `# Parking addendum
Envelope ID: CCCC3333-4444-4555-FADE-CAB456789012
Reserved parking slots on level B2. Guarantee covers parking fees and the
bank guarantee renews annually with the lease agreement.`,

  // people/: frontmatter values indexed, folder tokens (people/person) excluded
  "people/asha.md": `---
role: VP Engineering
location: Boston
tags: [leadership]
---
# Asha Mehta
Owns platform strategy and the quarterly engineering roadmap.`,
  "people/lukas.md": `---
role: Staff Engineer
location: Berlin
---
# Lukas Weber
Owns fleet dispatch and the routing engine internals.`,

  // malformed frontmatter — must warn and still count the note
  "people/broken.md": `---
tags: [#oops, #bad]
---
# Broken note
This body is skipped for keywords but the note is counted.`,

  // deep/: exceeds default depth (2) at the third level
  "deep/one/two/buried.md": "# Buried\nThis folder is beyond the depth limit.",
  "deep/one/present.md":
    "# Present\nWithin depth, mentions telescopes twice: telescope optics, telescope mounts.",
};

// imports/: six homogeneous siblings that must collapse into imports/
const boilerplate = [
  "Lease agreement between landlord and tenant with signature page attached.",
  "Rent schedule and lease term apply as stated in the appendix.",
  "Bank guarantee and insurance certificate are required before occupancy.",
];
for (let i = 0; i < 6; i++) {
  const shared = boilerplate.filter((_, j) => j !== i % 3).join("\n");
  FIXTURE[`imports/tenant-${i}/contract.md`] =
    `# Converted document ${i}\n${shared}\nSuite ${100 + i} on floor ${i}.`;
}

// areas/: six heterogeneous siblings that must stay separate
const topics = [
  ["alpha", "Kubernetes ingress routing and pod autoscaling policies."],
  ["beta", "Payroll tax withholding tables for hourly contractors."],
  ["gamma", "Sourdough fermentation schedules and hydration ratios."],
  ["delta", "Telescope collimation steps for reflector optics."],
  ["epsilon", "Beehive winterization and varroa mite treatment."],
  ["zeta", "Marathon training splits and lactate threshold pacing."],
] as const;
for (const [name, body] of topics) {
  FIXTURE[`areas/${name}/note.md`] = `# ${name} notes\n${body}`;
}

const vault = createTempVault(FIXTURE);
afterAll(() => vault.cleanup());

describe("getOverview golden", () => {
  test("default options", () => {
    const result = getOverview(vault.vaultPath, vault.vaultPath);
    expect(result).toMatchSnapshot();
  });

  test("depth 3, keywords 8", () => {
    const result = getOverview(vault.vaultPath, vault.vaultPath, {
      depth: 3,
      keywords: 8,
    });
    expect(result).toMatchSnapshot();
  });

  test("collapse disabled", () => {
    const result = getOverview(vault.vaultPath, vault.vaultPath, {
      collapse: false,
      depth: 3,
    });
    expect(result).toMatchSnapshot();
  });
});
