# Release Contract

The public release surface is intentionally short and boring. It should feel like a trustworthy
handoff, not a workbench dump.

## File Set

The release contains exactly these public files:

- `README.md`
- `manifest.json`
- `dcgov.sqlite`
- `entities.csv/json`
- `relationships.csv/json`
- `sources.csv/json`
- `datasets.csv/json`
- `legal_refs.csv/json`
- `entity_legal_refs.csv/json`
- `relationship_legal_refs.csv/json`

## Trust Model

- Accepted canonical facts are public.
- Source inventory and dataset inventory are public.
- Evidence remains source-backed, compact, and reviewable.
- Personal contact details and local filesystem paths are never allowed in release output.

## Model Semantics

- `entities.*` contains canonical civic entities such as public bodies, offices, seats/roles, status
  markers, and source-backed public official observations.
- Public official observations are source-backed role or seat observations, not a personnel or
  contact directory.
- `datasets.*` and `legal_refs.*` are separate inventory/reference tables. They are not promoted to
  civic entities unless a source-backed entity fact supports that.
- `relationships.*` stores one directed fact per row:
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
- Pending, deferred, blocked, and stale work must stay visible in release summaries instead of being
  silently treated as complete.
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
- `source_artifacts`

## Verification

Use:

```bash
deno task dc -- release verify
```

This checks unresolved release work, source-artifact provenance, and accepted relationship-row
provenance before a public handoff.

## Query Cookbook

Example SQLite queries live in [RELEASE_QUERY_COOKBOOK.sql](RELEASE_QUERY_COOKBOOK.sql).
