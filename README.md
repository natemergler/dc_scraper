# Civic Ledger

A source-backed civic ledger for Washington, DC.

DC civic data is public, but the useful facts are scattered across source portals, legal locators,
GIS layers, agency pages, Council pages, court pages, and public-body records. Those sources can be
stale, duplicated, partial, or too broad for a civic structure release.

This repository turns that material into a Git-visible ledger: organizations, offices, positions,
areas, legal-source anchors, legal authorities, source-backed relations, citations, and review
decisions. Source material is read into an ignored local workspace, interpreted into ledger
fragments, reconciled into a baseline, corrected by tracked revisions, and written into committed
state.

The committed state is the thing to read, diff, review, and release. GovGraph projections, CSVs, and
SQLite packages are generated from that state; they are outputs, not the internal source of truth.

## Status

DC is the first jurisdiction and the alpha contract-readiness target.

The current alpha package is a reproducible checkpoint from committed state, not a promise of
complete live DC coverage. The latest local export contains more than 1,200 ledger entries, more
than 1,100 relations, source coverage rows for collected, collected-empty, and inventory-only source
categories, and zero release-blocking GovGraph review items.

The old CSV packet remains useful as a checklist and vocabulary seed. It is not treated as current
authority.

## Alpha scope

In scope:

- Source-backed DC civic structure from collected public sources.
- A visible source inventory that distinguishes collected sources from inventoried-only backlog
  categories.
- Agencies, boards, commissions, councils, ANCs, SMDs, Council members, committees, courts, Mayor
  and BEGA structure, legal-source anchors, and explicit legal authority locators.
- Conservative relationship types such as `authorized_by`, `contains`, `governs`, `part_of`,
  `reports_to`, `holds`, `represents`, `member_of`, and `chairs`.
- Reviewable revisions for curated corrections, source-shadow decisions, identity caveats, and
  source-derived state changes.

Out of scope for alpha:

- Complete legal research, full statute/regulation ingestion, legal advice, or inferred powers.
- Contact directories, member rosters, staff biographies, phone/email fields, meeting details, and
  personal profiles.
- Broad budget, procurement, permits, property, public-safety, elections, LIMS, or legal-publication
  ingestion beyond the explicit source inventory rows.
- Implied `appoints`, `oversees`, `advises`, `administers`, or `enforces` edges unless a source
  explicitly supports a safe relation.
- Synthetic county, state, federal-branch, or generic city/county hierarchy filler without
  source-backed DC entries.

## CLI Surface

Run the CLI with `deno task civic <command>`.

Human output uses restrained terminal color for status, coverage, review queues, and next-action
hints when the terminal supports it. Set `CIVIC_LEDGER_COLOR=always` for captured demos or
`CIVIC_LEDGER_COLOR=never` for plain logs; JSON output stays uncolored.

- `status` shows workspace/source/state/review readiness and the next operator action; add `--json`
  for machine-readable readiness counts.
- `sources list` shows configured sources, coverage scope, and source-family rollups; add `--json`
  for machine-readable source coverage metadata, including publisher, access method, source URL, and
  catalog confidence.
- `collect <source-id>` pulls one source into the ignored workspace.
- `review list`, `review inbox`, `review next`, and `review deferred` refresh persisted review items
  from committed state before exposing review queues; add `--json` when automation needs filter
  metadata, queue counts, deferred groups, or the next actionable review item. Deferred groups
  include short explanations and sample source refs/URLs for why parked work is not blocking the
  active release path.
- `review show <item-id> --json` includes matching workspace source records, URL summaries, and raw
  payloads when the records are still present, so source-shadow and deferred decisions can be
  inspected without re-querying SQLite by hand.
- `revision validate` validates tracked revisions, draft revisions, and identity aliases.
- `state generate` rebuilds committed state from workspace records and tracked revisions.
- `state index` loads committed state back into the workspace SQLite index.
- `check` validates the committed state in place.
- `export` builds alpha release artifacts from committed state and refreshes the workspace index.
- `release verify [release-root]` checks an existing release package against `manifest.json` payload
  paths, byte sizes, SHA-256 checksums, schema version, artifact file/row counts, entity/relation
  kind rollups, release identity, zero GovGraph-blocking review items, review
  posture/category/deferred-description agreement, source coverage metadata/status/count/rollup
  agreement, and GovGraph summary contract; add `--json` for machine-readable validity, checked file
  count, and error details.

Typical operator flow:

```text
status -> revision validate -> state generate -> check -> export -> release verify
```

Use `collect all` whenever you need a full source refresh, or `collect <source-id>` for a targeted
refresh. Rerun `state generate` after source or revision changes. Treat `revision validate`,
`check`, and `release verify` as the last stops before handing off an alpha package.

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
deno task civic release verify releases/latest
```

The alpha export writes generic ledger files, a SQLite package, a release README, a manifest, source
coverage, DC-specific public views, and GovGraph JSON projections. `manifest.json` records the
stable payload output names, counts, byte sizes, and SHA-256 checksums. It does not checksum itself
because it contains the checksum table.

Manifest-managed payload files include:

```text
entries.csv
relations.csv
citations.csv
sources.csv
source_coverage.csv
ledger.sqlite
README.md
dc_board_affiliations.csv
dc_commission_affiliations.csv
dc_authority_affiliations.csv
dc_anc_smd_structure.csv
dc_council_committee_membership.csv
govgraph_nodes.json
govgraph_edges.json
govgraph_summary.json
```

The manifest itself is written as `manifest.json`.

Inspect `source_coverage.csv` when you need to explain each source's publisher, access method,
source URL, catalog confidence, collection status, reader/interpreter wiring, release status,
contribution, exclusions, and caveats.

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

The following collected source families are wired:

```text
DCGIS ArcGIS tables        -> agencies, boards, commissions, councils, authority coverage, ANCs, SMDs
dc.gov agency directory    -> official URLs for resolved canonical agencies
Open DC public bodies      -> public-body entries, explicit authority locators, duplicate signals
dccouncil.gov pages        -> Councilmember, committee, chair, and membership structure
OANC profiles              -> ANC profile URLs and ward-to-ANC containment evidence
Mayor/DC.gov pages         -> Mayor and EOM office structure
BEGA/OGE/OOG pages         -> institutional structure entries and part_of relations
D.C. Courts pages          -> court system, court, and direct division structure
Legal entrypoints          -> official Code, Register/DCMR, law, court, and Mayor's Order anchors
```

The current live DCGIS authority layer is collected-empty. The alpha still emits the
`dc_authority_affiliations.csv` artifact and records `dcgis.authorities` in `source_coverage.csv`,
but the latest package correctly has zero `dc.authority` entries and zero authority affiliation rows
rather than inventing placeholder authorities.

The source coverage matrix also contains inventory-only backlog rows for Open Data catalog surfaces,
administrative datasets, budget/finance, procurement/contracting, permits/licenses, property/land,
public safety/crime, elections, legislation/LIMS, MOTA Quickbase-style public-body data, and
distinct legal families such as D.C. laws, federal-law context, DCMR, DCR, Mayor's Orders and
Memoranda, OAH/OAG, court legal materials, and the Home Rule Act. Those rows make the contract
inventory visible without pretending the alpha has automated readers for them.

Inspect `releases/latest/source_coverage.csv` after export when you need publisher/access metadata,
source-inventory confidence, current collection statuses, release statuses, and source-specific
caveats.

## Evidence model

A typical fact path looks like this:

```text
source record -> interpreted entry fragment -> citation -> relation -> committed state -> export
```

Fetch metadata such as HTTP `Last-Modified` stays with source snapshots and collection records. It
is not promoted into ledger entity attributes unless a tracked revision intentionally carries it as
part of a specific source-identity judgment, so routine page freshness changes do not masquerade as
civic state changes.

For example, a public-body or DCGIS row with an explicit D.C. Code, D.C. Law, or Mayor's Order
locator can produce a civic entry, a citation to the source record, a `dc.legal_authority:*` entry,
and an `authorized_by` relation. A suspicious duplicate or stale source fragment becomes a review
item and, when curated, a tracked revision instead of a one-off state edit.

Relationship names are evidence labels, not claims that the ledger has modeled every legal or
operational power. When a source only implies a governance, advisory, appointing, or administrative
relationship, the alpha either emits a narrower supported relation or keeps the ambiguity in review.
The GovGraph projection is stricter than raw release files: unsupported or stale relation verbs stay
inspectable in ledger artifacts but are not published as public graph edges unless they map to an
alpha-supported relationship.

One concrete trace:

```text
dcgis.ancs record 8F
+ oanc.profiles record 6/8F
-> ledger/dc/state/entries/dc.anc:8F.json
-> ledger/dc/revisions/2026-06-16-anc-8f-oanc-profile-enrichment.json
-> entries.csv + citations.csv + relations.csv + dc_anc_smd_structure.csv
```

That entry keeps the DCGIS canonical ID/name (`dc.anc:8F`, `ANC 8F`), preserves the OANC public
display label (`ANC 6/8F`) as source evidence, cites both source records, and uses DCGIS SMD rows
for `contains` relations to `dc.smd:8F01` through `dc.smd:8F05`. The revision records the human
judgment: preserve the OANC label and profile evidence without silently replacing the DCGIS
canonical identity.

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
