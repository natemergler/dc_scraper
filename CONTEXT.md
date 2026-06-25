# Context

Civic Ledger is a Git-visible ledger for civic structure.

The old repo is a parts bin, not the architecture to revive. Reuse source details, fixtures, tests,
and useful functions when they help. Keep the current Civic Ledger language and release shape.

## Product Shape

DC is the first jurisdiction.

The project reads public sources, stores local snapshots/records in an ignored workspace, compiles
source-derived fragments into a baseline, applies tracked revisions, writes committed state, and
exports release files from that state.

```text
sources + readers -> snapshots + records
records + interpreters -> fragments
fragments + rules -> baseline
baseline + revisions -> state
state -> release files
```

## Important Surfaces

```text
ledger/dc/state/       committed ledger, one file per entry
ledger/dc/revisions/   tracked curation overlays
.civic/workspace/      ignored snapshots, records, drafts, findings, SQLite indexes
releases/latest/       generated release files
```

Committed state is human-visible and diffable. The workspace is disposable scratch. Release files
are outputs.

## Vocabulary

Source: configured public material plus reader/interpreter wiring.

Reader: captures source material and emits source-shaped records.

Snapshot: captured source payload.

Record: parsed source unit.

Fragment: interpreter output; entry-shaped or relation-shaped source evidence.

Baseline: generated ledger draft before revisions.

Revision: tracked curation overlay for merges, suppressions, mappings, shadows, and corrections.

State: baseline plus revisions; committed ledger truth.

Entry: stable civic object. Families include organization, position, person, area, and authority.

Relation: directed source-backed connection between entries.

Citation: provenance pointer back to source material.

Finding: generated warning, ambiguity, conflict, or review item.

Conflict: blocking finding that must be resolved before state generation proceeds.

## Release Shape

The release is a reproducible checkpoint from committed state. It is not complete live DC coverage
and does not require a fresh live scrape to reproduce byte-identical release files.

Public CSVs now lead the release:

```text
dc_agencies.csv
dc_offices.csv
dc_councilmembers.csv
dc_council_committees.csv
dc_council_committee_memberships.csv
dc_public_bodies.csv
dc_public_body_affiliations.csv
dc_ancs.csv
dc_smds.csv
dc_wards.csv
dc_courts.csv
dc_legal_authorities.csv
dc_relationships.csv
dc_sources.csv
```

Upload assets should stay reader-facing: those public CSVs, GovGraph JSON, SQLite, manifest,
`SHA256SUMS`, and the release README. Trace CSVs and compatibility CSVs remain generated and
verified for audits, but they should not be promoted as one-by-one downloads. `ledger.sqlite`
bundles those audit and compatibility helper tables with the public tables. `manifest.json` records
`startHere`, `releaseAssets`, `localOnlyOutputs`, `sqliteTables`, row counts, columns, and hashes so
the boundary is machine-readable.

## Legal Authority Slice

The legal slice is narrow on purpose.

In scope:

```text
D.C. Code sections
D.C. Laws
Mayor's Orders
```

Deferred as legal authority entries:

```text
D.C. Acts
DCMR
U.S.C.
CFR
court rules
charter provisions
free-text enabling authority
legal entrypoint catalog pages
```

Legal authority entries use `dc.legal_authority:*`. Links use `dc.relation:authorized_by` from the
civic entry to the legal authority entry.

## Curation Rules

- Source-derived changes can update state without a revision.
- Human overrides need revisions.
- State can be edited during maintenance, but committed curated changes should be reproducible from
  source/rule changes, revisions, or schema/kind changes.
- Revisions apply to a fresh baseline. They should not patch forward from old state forever.
- A malformed or stale revision should stop generation before rewriting committed state.
- Do not promote source fragments just to silence review noise.

## DC Scope

Current focus:

```text
agencies
offices
Council
committees
public bodies
ANCs/SMDs
wards
courts
explicit legal locators
source inventory
```

Out of scope unless explicitly modeled:

```text
contacts
staff
meetings
full law text
budgets
procurement
permits
property
public safety
elections
full LIMS ingestion
```

Review queues distinguish release blockers from deferred source-family work. Applied review items
are retained as evidence of handled curation decisions.
