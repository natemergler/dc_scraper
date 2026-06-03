# ADR 0002: Resolution Events Replay From JSONL

## Status

Accepted

## Decision

Human and workbench review decisions are recorded as replayable JSONL resolution events.

## Why

- The main review path should write decisions through the CLI, not through hand-edited diffs.
- Replayable events make refetch and rebuild flows deterministic and auditable.
- Conflicts can fail loudly and return the maintainer to review instead of silently drifting.

## Consequences

- Review actions must be modeled as decisions, not incidental text changes.
- Resolution payloads are part of the typed interface surface.
