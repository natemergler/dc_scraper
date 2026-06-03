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

This checks unresolved release work and source-artifact provenance before a public handoff.

## Query Cookbook

Example SQLite queries live in [RELEASE_QUERY_COOKBOOK.sql](RELEASE_QUERY_COOKBOOK.sql).
