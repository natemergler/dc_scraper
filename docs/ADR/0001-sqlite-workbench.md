# ADR 0001: SQLite Is The Workbench

## Status

Accepted

## Decision

The live v2 workbench uses SQLite as the local index, review, and release-preparation layer.

## Why

- The repo needs a local, typed, queryable workbench that is not a YAML database.
- Source artifacts can stay as files while SQLite carries structured state.
- Review, reconciliation, and release verification are easier to query and test this way.

## Consequences

- The product supports creating a new current-schema workbench or reopening a current-schema
  workbench. Older ignored local DBs are rebuildable scratch state, not a compatibility promise.
- Release SQLite is rebuilt from whitelisted public tables, not copied from the workbench.
