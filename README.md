# Civic Ledger

A Git-visible civic ledger for Washington, DC.

This repository maintains a structured account of a jurisdiction: its organizations, positions,
people, areas, authorities, relations, and citations back to public material.

The ledger is built from public sources, but it is not just a scraper. Source material is read into
a local workspace, interpreted into ledger fragments, reconciled into a baseline, corrected by
tracked revisions, and written into committed state.

The committed state is the thing to read, diff, review, and release.

## Status

Early rebuild.

The old prototype contains useful source readers, parsing logic, SQLite code, tests, and export
ideas. The new architecture is a clean break.

DC is the first jurisdiction. The system should be general enough for other jurisdictions later.

## CLI Surface

Run the CLI with `deno task civic <command>`.

- `status` shows workspace/source/state/review readiness and the next operator action.
- `sources list` shows configured sources and coverage scope; add `--json` for machine-readable
  source coverage metadata.
- `collect <source-id>` pulls one source into the ignored workspace.
- `revision validate` validates tracked revisions, draft revisions, and identity aliases.
- `state generate` rebuilds committed state from workspace records and tracked revisions.
- `state index` loads committed state back into the workspace SQLite index.
- `check` validates the committed state in place.
- `export` builds alpha release artifacts from committed state and refreshes the workspace index.

Typical operator flow:

```text
status -> revision validate -> state generate -> check -> export
```

Use `collect all` whenever you need a full source refresh, or `collect <source-id>` for a targeted
refresh. Rerun `state generate` after source or revision changes. Treat `revision validate` and
`check` as the last stops before `export`.

Common loops:

```text
# fresh or stale workspace
deno task civic status
deno task civic sources list
deno task civic collect all

# before committing state changes
deno task civic revision validate
deno task civic state generate
deno task civic check

# alpha package
deno task civic export
```

The alpha export writes generic ledger files, a SQLite package, a manifest, source coverage, and
DC-specific public views:

```text
entries.csv
relations.csv
citations.csv
sources.csv
source_coverage.csv
ledger.sqlite
manifest.json
README.md
dc_board_affiliations.csv
dc_commission_affiliations.csv
dc_authority_affiliations.csv
dc_anc_smd_structure.csv
dc_council_committee_membership.csv
```

Inspect `source_coverage.csv` when you need to explain what each configured source contributes,
excludes, or only partially covers.

## Shape

```text
sources + readers -> snapshots + records
records + interpreters -> fragments
fragments + rules -> baseline
baseline + revisions -> state
state -> release artifacts
```

The important surfaces are:

```text
ledger/dc/state/
  the committed civic ledger, one file per entry

ledger/dc/revisions/
  tracked curated overlays that persist corrections across source refreshes

.civic/workspace/
  ignored local snapshots, records, baseline, findings, conflicts, and SQLite indexes

releases/
  generated packages, usually not committed directly
```

## Working model

A source refresh may change the ledger state directly when the change is source-derived.

A human correction should become a revision.

```text
edit state
derive or write revision
regenerate state
verify
commit state + revision
```

State is editable, but committed state should be reproducible from sources, rules, and revisions.

## Current coverage

The following source families are wired:

```text
ArcGIS table reader           - DCGIS agencies, boards, commissions, authorities, ANCs, SMDs
dccouncil.gov HTML reader     - Council members and committee pages
DC agency/board/commission    -> organization entries with governance relations
DC ANC/SMD                    -> area entries with containment relations
DC ANC commissioner seats     -> position entries with representation relations
DC Council members            -> person entries with committee membership relations
```

Everything else waits until the above path is stable.

## Legal authority alpha boundary

The alpha legal authority slice is intentionally narrow. It derives `dc.legal_authority` entries and
`dc.relation:authorized_by` links only from explicit locators already present in source-derived
citations for:

```text
D.C. Code sections
Mayor's Orders
D.C. Laws
```

It does not yet model D.C. Acts, DCMR, U.S.C., CFR, court rules, charter provisions, free-text
enabling authority, or legal entrypoint catalog pages as legal authorities. Those remain future
scope, not missing alpha export files.

## Docs

Start here:

```text
CONTEXT.md
  why this exists, what to preserve from the old prototype, and what not to preserve

ARCHITECTURE.md
  the ledger model, module boundaries, and invariants
```

Later, once the first slice exists, this repo may add a stricter `SPEC.md`.
