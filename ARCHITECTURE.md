# ARCHITECTURE.md

Civic Ledger maintains a versioned civic graph for a jurisdiction.

The project is Git-like in one specific sense: the committed ledger state is human-readable,
diffable, and versioned in the repository. Raw source material and local computation live in an
ignored workspace.

## Planes

### 1. Upstream plane

External public material.

Examples:

```text
ArcGIS tables
open data APIs
HTML pages
PDFs
CSV downloads
legal/code pages
```

These are outside our control.

### 2. Workspace plane

Local ignored working state.

Contains:

```text
snapshots
records
fragments
baseline
findings
conflicts
draft revisions
SQLite indexes
```

The workspace must be disposable in principle, but useful to keep around for historical/debug
context.

### 3. Curation plane

Tracked revision files.

Revisions are curated overlays over the generated baseline. They persist human judgment across
source refreshes.

Examples:

```text
map this source record to this entry
merge these generated entries
suppress this source-derived relation
override this entry kind
mark this interpretation uncertain
```

### 4. State plane

Committed ledger state.

State is final resolved ledger content: baseline plus revisions.

It is organized one file per entry and is the main Git-visible civic ledger.

### 5. Distribution plane

Generated release artifacts.

Examples:

```text
CSV files
SQLite release DB
JSON manifests
GitHub release assets
```

Release artifacts are generated from committed state. They are not where truth is created.

## Flow

```text
source
  -> reader
  -> snapshot
  -> record
  -> interpreter
  -> fragment
  -> ledger compiler
  -> baseline
  -> revisions
  -> state
  -> index
  -> export
```

## Core modules

### Reader

Reads a source and emits snapshots plus records.

Readers are source-shaped. They understand access mechanics, not civic meaning.

Examples:

```text
arcgis.table
json.api
html.page
csv.download
pdf.collection
```

A reader should be generic when capture mechanics repeat. Use specialized readers only when the
access pattern genuinely differs.

### Interpreter

Turns records into source-derived ledger fragments.

Interpreters are jurisdiction/source-specific. They know how source-shaped records map toward the
ledger model, but they do not produce final truth.

Interpreter output may include:

```text
entry fragments
relation fragments
citations
findings
mapping hints
```

### Ledger Compiler

The core engine.

Inputs:

```text
fragments
jurisdiction rules
kind registry
tracked revisions
```

Outputs:

```text
baseline
state
findings
conflicts
```

Responsibilities:

```text
resolve identity
merge/dedupe fragments
combine citations
construct baseline
apply revision overlays
validate final graph
write state or stop on conflicts
```

The compiler contains the baseline reconciliation and revision application passes.

### State Store

Loads, validates, and writes committed state files.

State files are entry-first and deterministic.

Responsibilities:

```text
one-file-per-entry layout
stable ordering and formatting
typed declarative data loading
runtime validation
state diff support
```

The rest of the system should not depend on the exact state file format.

### Revision Store

Loads and validates tracked revisions.

Revisions are curated overlays, not raw text diffs and not immutable event logs.

The exact syntax is unsettled, but the store should expose revisions to the compiler as structured
overlays.

### Workspace

Local ignored build/index area.

Recommended shape:

```text
.civic/
  workspace/
    civic.sqlite
    snapshots/
    records/
    conflicts/
    drafts/
```

SQLite indexes records, fragments, baseline, findings, draft revisions, and indexed state.

Raw captures are files.

### Indexer

Loads committed state into workspace SQLite for query, validation, explanation, backlink generation,
and export.

Flow:

```text
state files -> SQLite graph index -> inspect/explain/export
```

### Exporter

Builds consumer-facing packages from indexed state.

Exporter does not read raw sources or create truth.

Release artifacts should include generic ledger exports and jurisdiction-specific views.

### Jurisdiction Pack

Defines jurisdiction-specific behavior.

A pack contains:

```text
entry kind definitions
relation kind definitions
sources
interpreters
rules
export views
```

The core engine must not hardcode DC concepts.

## State model

State is organized around entries.

A state entry file contains:

```text
id
family
kind
name
attributes
citations
outgoing relations grouped as facets
```

Relations are first-class graph objects, but authored under their `from` entry.

Inverse/backlink views are generated.

State contains final resolved ledger only. It does not include baseline values side-by-side.

## Entry families

Portable core families:

```text
organization
position
person
area
authority
```

Jurisdictions define kinds within families.

Examples for DC (current kinds):

```text
dc.agency
dc.board
dc.commission
dc.authority
dc.anc
dc.smd
dc.anc_commissioner_seat
dc.committee
dc.councilmember
```

## Kind definitions

A kind definition should produce both:

```text
runtime validator
TypeScript authoring type
```

The runtime object is used by the engine.

The inferred type is used by state files.

## Citations

A citation points back to source material.

It is provenance, not legal authority.

Legal authority is modeled as an `authority` entry.

State files should usually use inline citation helpers:

```ts
citations: [
  cite("dcgis.agencies", {
    recordKey: "AGENCY_ID:<value>",
    fields: ["AGENCY_NAME", "TYPE"],
  }),
];
```

Entries and relations should normally have at least one citation. If an entry is model-defined or
bootstrap-only, use an explicit marker such as:

```ts
uncited("Ledger bootstrap grouping for DC executive branch");
```

## Revisions

A revision is a tracked curated overlay over baseline.

Revisions should be organized around ledger primitives:

```text
entries
relations
citations
identity mappings
suppressions
notes
```

They should not default to low-level text diffs.

Revisions are editable tracked files. Git history records how they change.

## Conflicts

A revision persists across source refreshes until it conflicts.

A conflict occurs when a revision can no longer apply cleanly or would produce invalid state.

On conflict:

```text
do not rewrite committed state
write local conflict/draft revision work
ask the maintainer in interactive mode
fail or follow explicit policy in noninteractive mode
```

Resolution should normally produce or update a tracked revision.

## Workspace vs state

The workspace is not the public ledger.

State is committed.

SQLite indexes state for query/export, but SQLite is not the public ledger.

## Release model

A release is a named publication of a committed ledger state.

It should correspond to a Git tag/GitHub Release and generated artifacts.

A release contains:

```text
generic ledger export
jurisdiction-specific views
manifest
README
queryable SQLite package
```

Generic exports preserve portability. Jurisdiction views make the release useful.

## Invariants

```text
State is deterministic.
State is one file per entry.
State changes are reviewed through Git diff.
Source-derived state changes do not require revisions.
Curated state changes require revisions.
Committed state must be explainable by source/rule changes, revisions, or schema/kind changes.
Records and snapshots are not committed by default.
Releases are generated from indexed committed state.
```
