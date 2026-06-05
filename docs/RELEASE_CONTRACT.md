# Release Contract

The public release surface is intentionally short and boring. It should feel like a trustworthy
handoff, not a workbench dump.

## File Set

The release contains exactly these public files:

- `README.md`
- `manifest.json`
- `dcgov.sqlite`
- `01_sources_and_portals.csv`
- `02_public_datasets.csv`
- `03_legal_authorities.csv`
- `entities/all_entities.csv`
- `entities/elected_and_seats.csv`
- `entities/agencies_and_offices.csv`
- `entities/boards_commissions_public_bodies.csv`
- `entities/council_committees.csv`
- `entities/courts_and_legal_bodies.csv`
- `entities/wards_ancs_smds.csv`
- `entities/roles_statuses_observations.csv`
- `relationships/all_relationships.csv`
- `relationships/structure_relationships.csv`
- `relationships/authority_relationships.csv`
- `relationships/representation_membership_relationships.csv`
- `references/entity_sources.csv`
- `references/relationship_sources.csv`
- `references/entity_legal_authorities.csv`
- `references/relationship_legal_authorities.csv`

## Trust Model

- Accepted canonical facts are public.
- Source inventory and dataset inventory are public.
- CSV files are human-facing grouped views; `dcgov.sqlite` is the full queryable package.
- Compact `relationships/all_relationships.csv` rows expose accepted directed facts, not row-level
  evidence payloads.
- Evidence remains source-backed, compact, and auditable in the workbench before handoff.
- Personal contact details and local filesystem paths are never allowed in release output.
- The generated `README.md` is a public package guide. It does not carry review status, readiness,
  unresolved-work, or workbench caveat language.

## Model Semantics

- `entities/all_entities.csv` contains canonical civic entities such as public bodies, offices,
  seats/roles, status markers, and source-backed public official observations.
- Public official observations are source-backed role or seat observations, not a personnel or
  contact directory.
- `02_public_datasets.csv` and `03_legal_authorities.csv` are separate inventory/reference views.
  They are not promoted to civic entities unless a source-backed entity fact supports that.
- `relationships/all_relationships.csv` stores one directed fact per row:
  `from_entity_id --relationship_type--> to_entity_id`.
- Relationship types cover structure, authority/source, and civic role facts; incoming/backlink
  views are derived instead of storing inverse facts.
- Relationship direction guide:
  - `part_of`: component -> containing entity.
  - `has_seat` / `has_status`: body, seat, or observation -> seat/status marker.
  - `governed_by`, `overseen_by`, `appointed_by`, `designated_by`, `authorized_by`, `published_by`:
    civic subject -> governing, oversight, appointment, designation, legal-authority, or publication
    source.
  - `holds`, `represents`, `member_of`, `chairs`: observation or role entity -> seat, district,
    body, or committee role.
- Pending, deferred, blocked, and stale work must stay visible in status, audit, manifest, or
  inspect surfaces before handoff instead of being silently treated as complete.
- DC city/county distinctions, legal coverage, personnel coverage, and dataset coverage are not
  inferred beyond bounded source-backed evidence.

## Manifest

`manifest.json` is part of the contract. It includes:

- `manifest_version`
- `release_id`
- `tool_version`
- `git_commit`
- `source_profile`
- `schema_version`
- `generated_at`
- `files`
- `release_summary`
- `source_artifacts`, as source artifact inventory without local paths

## Verification

Use:

```bash
deno task dc -- release verify
deno task dc -- release inspect
```

`release verify` checks source-artifact provenance, release blockers, and repeatable row-family
provenance in the workbench before a public handoff. It checks that accepted entity and relationship
rows, dataset rows, legal-ref rows, and legal-ref attachment rows still trace to source-backed
workbench decisions or references; visible review decisions stay in status, audit, manifest, and
inspect surfaces without automatically invalidating source-backed release rows.

`release inspect` checks the built release directory against `manifest.json`: expected file count,
actual file count, file hashes, missing files, and unexpected entries. Package-integrity problems
make the built-package summary conservative even when the manifest itself can be read; known
package-integrity problems are counted in readiness reasons. It also prints compact blocking
readiness reasons and warning reasons from `release_summary` when the package is warning or not
ready. The default text output stays compact; use `release inspect --json` for structured
package-integrity, blocking `readinessReasons`, `warningReasons`, `warningReviewCommand`,
`publicBodyCompareCommand`, `browseCommand`, `inspectCommand`, `nextCommand`, and release-summary
details from `release_summary`. The summary keeps broad `public_body_variant_lead_count` linkage
context while `public_body_release_risk_variant_lead_count` isolates accepted duplicate-risk leads
that still drive release warnings.

## Query Cookbook

Example SQLite queries live in [RELEASE_QUERY_COOKBOOK.sql](RELEASE_QUERY_COOKBOOK.sql).
