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

## First target

The first useful slice is intentionally small:

```text
ArcGIS table reader
DCGIS agencies source
DC agency interpreter
ledger compiler
one-file-per-entry state
inline citations
workspace SQLite index
minimal export
```

Everything else waits until that path works.

## Docs

Start here:

```text
CONTEXT.md
  why this exists, what to preserve from the old prototype, and what not to preserve

ARCHITECTURE.md
  the ledger model, module boundaries, and invariants
```

Later, once the first slice exists, this repo may add a stricter `SPEC.md`.
