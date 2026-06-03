# ADR 0003: Keep The Release Surface Compact

## Status

Accepted

## Decision

The public release package stays short: one README, one manifest, one SQLite file, and compact
CSV/JSON exports for entities, relationships, sources, datasets, and legal references.

## Why

- The product is a trustworthy public handoff, not a workbench dump.
- Smaller release files are easier to inspect, document, and verify.
- Raw rows, review internals, artifacts, and resolution logs belong in the workbench, not the public
  package.

## Consequences

- New public files should be added only when the existing compact surface is already working well.
- Review-status notes belong in the release README when needed, not in a side-car caveats file.
