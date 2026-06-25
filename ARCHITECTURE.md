# Architecture

Civic Ledger keeps a jurisdiction's civic graph in Git-visible state and generates release files
from that state.

## Planes

```text
upstream      public websites, APIs, GIS layers, CSVs, PDFs, legal pages
workspace     ignored local snapshots, records, fragments, findings, SQLite indexes
curation      tracked revisions and identity aliases
state         committed ledger entries and relations
distribution  CSV, JSON, SQLite, manifest, GitHub release assets
```

Truth is created before distribution. Release files should be reproducible from committed state.

## Flow

```text
reader -> snapshot -> record
record -> interpreter -> fragment
fragments + rules -> baseline
baseline + revisions -> state
state -> index -> export
```

## Main Parts

Readers fetch source material and normalize access mechanics. They should know how to read ArcGIS,
HTML, JSON, CSV, or PDF-like sources, but not decide civic truth.

Interpreters map source-shaped records into candidate ledger fragments, citations, and findings.
They are allowed to be jurisdiction-specific.

The compiler reconciles fragments into a baseline, applies revisions, combines citations, and stops
on unsafe conflicts.

Revisions are tracked curation overlays: merge this, suppress that, preserve these as distinct,
shadow this source fragment, adjust an identity, or keep a sourced caveat.

The state store reads and writes deterministic one-file-per-entry ledger state.

The exporter writes public CSVs, local audit CSVs, GovGraph JSON, SQLite, a manifest, and a short
release README.

## Repository Layout

```text
src/
  cli/                  CLI commands
  core/                 shared ledger types
  export/               release export and verification
  jurisdictions/dc/     DC readers, interpreters, runtime config
  review/               generated review items and queue rules
  state/                committed-state loading/validation
  workspace/            ignored workspace DB/files

ledger/dc/
  state/                committed entries
  revisions/            tracked curation overlays
  identity_aliases.json identity map

.civic/workspace/       ignored local working data
releases/latest/        generated release files
```

## Release Contract

The public release has two surfaces.

Readable DC tables:

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

Upload alongside those tables:

```text
govgraph_nodes.json
govgraph_edges.json
govgraph_summary.json
ledger.sqlite
manifest.json
SHA256SUMS
README.md
```

Traceability CSVs (`_local/ledger_entries.csv`, `_local/ledger_relations.csv`,
`_local/ledger_citations.csv`, `_local/source_counts.csv`, `_local/source_coverage.csv`) are
generated and verified for audits, but they are not standalone GitHub release assets. The same is
true for compatibility CSVs: `_local/dc_board_affiliations.csv`,
`_local/dc_commission_affiliations.csv`, `_local/dc_authority_affiliations.csv`,
`_local/dc_anc_smd_structure.csv`, and `_local/dc_smd_commissioners.csv`. `ledger.sqlite` is the
bundled database: it includes public tables, audit tables, compatibility helper tables, raw ledger
views, and `release_table_catalog`.

`manifest.json` records `startHere`, `releaseAssets`, `localOnlyOutputs`, `sqliteTables`, output
categories, row/column metadata, and release-asset status. `release verify` checks file presence,
manifest hashes, row counts, source coverage agreement, review posture, and GovGraph invariants.

## Curation Rules

- Fix extraction/modeling bugs in readers or interpreters.
- Fix identity, suppression, and preserve-distinct decisions in revisions.
- Fix release shape in exporters.
- Do not make broad relations from names alone.
- Do not promote stale, duplicate, or out-of-scope source records just to quiet a queue.

## Current DC Emphasis

The release focuses on DC civic structure: agencies, public bodies, Council, committees, ANCs/SMDs,
wards, courts, and explicit legal locators. Current-output review blockers must be zero before a
release. Deferred Open DC source-family work is kept visible but does not automatically block the
release.
