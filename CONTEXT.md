# CONTEXT.md

This repository is being rebuilt around a new model: **Civic Ledger**.

The old codebase is useful as a prototype and parts bin, but it is not the architecture to preserve.
Mine it for working functions, source details, fixtures, tests, and release logic. Do not preserve
`v2` naming, old docs, old CLI shape, or old vocabulary by default.

## What this project is

Civic Ledger is a Git-visible ledger for civic structure.

It reads public sources, stores local snapshots and records in a workspace, compiles source-derived
fragments into a baseline, applies curated revisions, writes committed state, and builds release
artifacts from that state.

DC is the first jurisdiction. The architecture should allow future jurisdiction packs.

## Core idea

```text
sources + readers -> snapshots + records
records + interpreters -> fragments
fragments + rules -> baseline
baseline + revisions -> state
state -> indexed workspace
indexed state -> release artifacts
```

The committed `state/` is the human-visible ledger. It is what GitHub users can browse and diff.

The workspace is local and ignored. It contains snapshots, records, fragments, baseline, findings,
conflicts, and SQLite indexes.

Revisions are tracked curated overlays. They make manual fixes, mappings, merges, suppressions, and
other intentional changes persist across future source refreshes.

## Important terms

### source

Tracked jurisdiction config describing external public material and how to process it.

A source binds a reader and an interpreter.

### reader

Code that reads a source, captures snapshots, and emits source-shaped records.

Readers should be generic by capture mechanics where possible: ArcGIS table, JSON API, HTML page,
CSV download, etc.

Readers do not decide civic meaning.

### snapshot

Captured source material at a point in time.

Snapshots live in the workspace and are not committed by default.

### record

A parsed unit from a snapshot.

Records belong to sources. Entries belong to the ledger.

### fragment

Interpreter output. A fragment is entry-shaped or relation-shaped material derived from a
record/source perspective.

Fragments are workspace data, not committed ledger data.

### baseline

The generated source/rule-derived ledger draft before revisions are applied.

Baseline is a logical ledger state stored in the workspace, not committed.

### revision

A tracked curated overlay over the baseline.

Revisions are not immutable event logs. They may be edited, renamed, split, or squashed while the
model matures. Git history provides history.

### state

The final resolved ledger: baseline plus revisions.

State is committed, human-visible, Git-diffable, and organized one file per entry.

State can be edited directly as a maintenance workflow, but committed curated state changes must be
reproducible through revisions.

### alpha release

A reproducible release checkpoint for committed state that is suitable for external evaluation
without claiming complete civic coverage or product integration.

An alpha release is reproducible from committed state to release artifacts. It does not require a
fresh live-source collection to reproduce identical state.

Alpha release artifacts are generated distribution outputs. They should be attached to a release or
regenerated locally, not maintained as committed ledger truth.

An alpha release artifact includes generic ledger files, a SQLite ledger, source coverage, and
DC-specific views for board affiliations, commission affiliations, authority affiliations, ANC/SMD
structure, and Council committee membership.

An alpha release artifact presents established state-derived facts. Review items, findings,
conflicts, draft revisions, and unresolved duplicate reports remain operator/review surfaces rather
than alpha artifact files.

An alpha release includes a bounded legal authority slice for explicit legal authority locators that
already appear in source-derived citations.

The alpha legal authority slice includes D.C. Code sections, Mayor's Orders, and D.C. Laws. It
defers D.C. Acts, DCMR, U.S.C., CFR, court rules, charter provisions, free-text enabling authority,
and legal entrypoint catalog pages as legal authorities.

Alpha legal authority entries use the single `dc.legal_authority` kind with canonical IDs under
`dc.legal_authority:*`, while preserving the authority family/type as attributes.

Alpha legal authority links use `dc.relation:authorized_by` from the civic entry to the legal
authority entry.

Alpha legal authority entries and links are derived from entry citations with explicit in-scope
legal authority locators.

### entry

A stable ledger object.

Core entry families:

```text
organization
position
person
area
authority
```

Jurisdictions define entry kinds inside those families.

### institutional structure

The civic bodies, offices, courts, positions, areas, and relations that define how a jurisdiction is
organized.

### relation

A directed connection between entries.

Relations are first-class graph objects, but in committed state they are authored under their `from`
entry.

### citation

A provenance pointer from an entry, relation, or revision back to source material.

Citation is not legal authority. Legal authority is an `authority` entry.

### legal authority

A legal instrument or legal unit that establishes, authorizes, governs, or otherwise grounds a civic
fact.

### finding

Generated workspace-local issue, ambiguity, warning, note, or conflict.

This term is provisional.

### conflict

A blocking finding that prevents generation until a maintainer resolves it.

## Core decisions

### State is editable but not self-justifying

You can edit `state/` directly because it is the most natural maintenance surface.

But a committed curated state change must be explainable by one of:

```text
source/rule changes
tracked revisions
schema/kind changes
```

Manual changes should be turned into revisions, then state should be regenerated and verified.

### Revisions apply to a fresh baseline

Generation does not patch forward from previous state forever.

It regenerates baseline from current workspace records and rules, then applies tracked revisions.

```text
sources + readers + interpreters + rules -> baseline
baseline + revisions -> state
```

### Source-derived changes do not require revisions

If a source changes and the baseline changes, state may change without a curated revision.

A revision is required for human overrides, merges, suppressions, mappings, and curated corrections.

### Conflicts become draft revision work

When a revision can no longer apply cleanly, generation should stop before rewriting committed
state.

It should create local conflict/draft-revision work in the workspace. The maintainer resolves the
conflict by editing or adding revisions, then reruns generation.

### Records are not committed by default

Records are useful for explanation, refresh comparison, review, and citations, but they remain
workspace data.

Committed state can reference source/record keys compactly through citations.

### State is entry-first

Committed state is organized around ledger primitives, not DC-specific folders.

One file per entry.

Each entry owns:

```text
entry fields
entry citations
outgoing relation declarations
```

Backlinks and inverse views are generated.

### Typed ledger files are preferred

State and revision files should likely use TypeScript as typed declarative data, not executable
program logic.

The exact extension is unsettled.

Allowed spirit:

```text
declarative objects
type-only imports
satisfies SomeEntryType
cite(...)
uncited(...)
```

Not allowed in ledger files:

```text
fetch
Deno.readTextFile
new Date
Math.random
process.env
arbitrary runtime logic
```

### Kind definitions produce runtime validators and state types

A jurisdiction kind definition should be the source of truth for both runtime validation and
TypeScript authoring types.

Example concept:

```ts
export const dcWardKind = defineEntryKind({
  kind: "dc.ward",
  family: "area",
  attributes: {
    wardNumber: oneOf([1, 2, 3, 4, 5, 6, 7, 8]),
  },
});

export type DcWardEntry = EntryFromKind<typeof dcWardKind>;
```

## What to mine from the old code

Useful old-code assets include:

```text
ArcGIS pagination and row fetching
normalization helpers
HTML/text utilities
legal citation parsing ideas
SQLite helper functions
release CSV/SQLite writer ideas
tests and fixtures
source-specific knowledge
```

Do not preserve old architecture by default.

## Non-goals for the first pass

```text
No v2 naming
No legacy compatibility layer
No broad source port
No giant framework before a vertical slice
No generated prose sprawl
No committing snapshots, records, workspace DBs, or release artifacts by default
No pretending everything is complete
```

## Current implementation

The following slices have landed:

```text
ArcGIS table reader           -> agencies, boards, commissions, authorities, ANCs, SMDs
dccouncil.gov HTML readers    -> council members and committees
agency/board/commission        -> dc.agency, dc.board, dc.commission
authority                      -> dc.authority
ANC/SMD                        -> dc.anc, dc.smd
commissioner seats             -> dc.anc_commissioner_seat (with provenance)
Council                        -> dc.councilmember, dc.committee
```

Next work should harden existing paths before adding new sources or entry kinds.
