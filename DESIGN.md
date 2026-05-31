# Design

This repo is moving to a v2 architecture. The goal is not to preserve the current YAML-as-database shape. The goal is a reliable workbench that can fetch public DC government sources, normalize source output, help a person review/resolve ambiguous entities and relationships, and generate a small source-backed release package.

The existing repo is reference material and seed work. Keep useful source knowledge, tests, and discovered endpoints. It is acceptable to refetch and rebuild the data model instead of migrating every current record.

## Product boundary

This repo produces data and evidence for downstream government-structure mapping. It is not the polished visualization and it is not a graph UI.

A release should be boring and useful:

```text
releases/latest/
  README.md
  manifest.json
  dcgov.sqlite
  entities.csv
  entities.json
  relationships.csv
  relationships.json
  sources.csv
  sources.json
  datasets.csv
  datasets.json
  legal_refs.csv
  legal_refs.json
```

The release README should be the only Markdown file in the release. Keep it short: what files exist, how to read them, how they were generated, and any review-status note needed to avoid misleading the reader.

## Architecture

Use four layers:

```text
source artifacts -> SQLite workbench -> resolution log -> release package
```

- Source artifacts are fetched files, snapshots, schemas, document indexes, or sample/full row dumps.
- SQLite is the local workbench and query/index layer.
- Resolutions are git-tracked human/workbench decisions that can be replayed.
- Releases are generated artifacts for people and downstream tools.

Do not mirror all workbench internals into the release. The release is a clean product surface; the database can contain the messy review and evidence state.

## Storage boundaries

Use files for:

```text
src/                       tool code
scripts/                   CLI entrypoints
config/                    source definitions and connector config, if not code
snapshots/ or data/snapshots/       fetched source artifacts
resolutions/               git-tracked JSONL decision logs
releases/                  generated release packages
docs/                      short operational docs only, if needed
```

Use SQLite for:

```text
sources and endpoints
source runs and artifact indexes
source items and parsed fields
entity candidates
canonical entities
relationship candidates
canonical relationships
legal references
dataset inventory
review items
resolution replay state
evidence links
incoming/outgoing relationship views
```

`workbench.sqlite` may be local/generated. `releases/latest/dcgov.sqlite` is a release artifact.

## Data flow

```text
fetch source
  -> write source artifact
  -> index source run/artifact in SQLite
  -> parse source items
  -> generate entity / relationship / legal / dataset candidates
  -> generate review items
  -> review interactively
  -> write resolution JSONL
  -> replay resolutions into canonical tables
  -> build release CSV/JSON/SQLite/README/manifest
```

Source parsing should preserve evidence. Canonical records should stay compact and skimmable.

## Source artifacts and capture modes

Avoid verbose source taxonomies. The tool only needs practical artifact kinds, such as:

```text
page
schema
sample
rows
documents
text
```

Examples of intent:

- An ArcGIS administrative dataset may only need schema/sample capture for the release inventory.
- A public-body registry may produce entities, relationships, legal refs, and source evidence.
- A legal source may start as a document index and later gain text archives.

Do not force high-volume data streams into the entity graph. They belong in the source/dataset inventory unless a specific source field produces a government entity or relationship.

## Entities

Canonical entities should be compact. Do not embed raw source rows in the main entity table/export.

A useful entity has fields like:

```text
id
name
kind
branch
cluster
budget_code
official_url
review_status
```

Keep source-specific values and raw rows in source items/evidence tables. Entity fields should be traceable back to evidence, but the entity itself should be easy to skim.

Entity kinds are allowed to evolve. DC has agencies, offices, boards, commissions, committees, ANCs, courts, elected offices, regional bodies, advisory groups, task forces, and weird edge cases. When unsure, preserve the source value, generate a review item, and avoid silent over-normalization.

## Relationships

Store canonical relationships as directed edges:

```text
from_entity_id, relationship_type, to_entity_id
```

Do not duplicate inverse relationships as separate facts. The system should still expose backlinks through SQLite views and CLI display.

For example, if the stored edge is:

```text
dc.mayor appoints dc.board_of_accountancy
```

then `dc entity show dc.board_of_accountancy` should display an incoming relationship like:

```text
appointed_by <- dc.mayor
```

Relationship candidates should be generated from source evidence where possible: governing agency fields, mayoral cluster fields, council oversight fields, enabling law fields, appointment/confirmation fields, and similar structural clues.

## Evidence

Evidence is not prose. Evidence links canonical/candidate facts back to source artifacts and source items.

Useful evidence references include:

```text
source_id
source_run_id
source_item_key
field/path/text selector
snapshot/artifact path
observed value
```

The review CLI should be able to answer: "Why do we think this entity/relationship exists?" without requiring someone to open raw JSON by hand.

## Resolutions

Resolutions are replayable decision logs, not hand-authored civic records. Prefer focused JSONL files grouped by review batch:

```text
resolutions/2026-06-01/001-dcgis-agency-merges.jsonl
resolutions/2026-06-01/002-open-dc-relationships.jsonl
```

The CLI should write resolution lines. A person should rarely need to hand-edit them.

Resolution operations should cover decisions such as:

```text
accept entity candidate
reject entity candidate
merge entity candidates
set canonical entity fields
accept relationship candidate
reject relationship candidate
edit relationship type/direction
mark review item deferred/reopened/resolved
```

Resolution replay must be deterministic and conflict-aware. If two resolutions disagree about a reviewed field or relationship, fail clearly and ask for review.

## Review CLI

The primary workflow should be interactive:

```bash
deno task dc -- review
```

Focused modes are useful, but should keep the same interaction style:

```bash
deno task dc -- review entities
deno task dc -- review relationships
deno task dc -- review sources
deno task dc -- review legal
```

The review screen should show:

```text
what needs review
why it matters
source evidence
likely/default action
single-key choices
```

The CLI should support scriptable commands too, but the main path should not require typing long flag-heavy commands for every resolution.

## Release builder

The v2 release builder should be purpose-built, not a generic dump of internal tables.

CSV columns should be intentional and stable. JSON can preserve more structure. SQLite can include workbench-adjacent views that are useful for querying, such as incoming/outgoing relationship views.

The manifest should include release metadata, schema version, source artifact hashes, and generated file list.

## Testing strategy

Use TDD for persistence, replay, review, and release behavior.

High-value tests:

```text
fresh DB initialization
migration ordering/versioning
source artifact parsing
candidate generation determinism
resolution replay determinism
resolution conflict detection
relationship inverse/backlink views
stable release CSV columns
interactive review writes expected resolutions
release can be rebuilt from committed inputs
```

Also test the CLI like a person will use it. Use fixtures and scripted stdin where possible. Manual smoke testing is expected for interactive flows; record the commands and observed behavior in PR notes when useful.

## Non-goals before v2 release

- Do not build a graph UI.
- Do not keep YAML records as the canonical database.
- Do not add more YAML record types.
- Do not make gaps, caveats, or update pipelines first-class product objects.
- Do not split code and data into separate repositories yet.
- Do not require compatibility with the old record layout.
- Do not run live scraping in CI by default.
- Do not write long generic Markdown docs.

If a better design appears during implementation, prefer the better design. Leave a short note in the PR or issue explaining why it improves the plan.
