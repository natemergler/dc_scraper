# Connector Authoring

Connectors are intentionally compact. A good connector fetches only the practical public surface it
needs, validates untrusted source data at the boundary, preserves evidence, and leaves ambiguity in
review instead of silently guessing.

## Source Metadata

Every real connector source should declare:

- `tier`: `tier0`, `tier1`, `tier2`, or `tier3`
- `releaseRole`: `structure`, `public_body`, `legal`, `appointments`, or `inventory`
- `smokeProfiles`: the temp-workbench smoke profiles this source participates in
- `privacyNotes`: short maintainer notes about what must stay out of release

Those fields drive operator docs, `dc source list`, and `dc smoke <profile>`.

## Shipping Checklist

Every connector change should ship with:

- fixture coverage for the public source shape you are adding or changing
- one source note in docs or code comments when a discovery changes operator expectations
- an explicit privacy statement in the connector metadata or PR notes
- an explicit release-surface statement: what can land in `entities.*`, `relationships.*`,
  `datasets.*`, or `legal_refs.*`, and what must stay out

## Implementation Rules

- Keep loose parsing only at the fetch/parse boundary. Validate into typed rows before import.
- Preserve source evidence and practical artifacts. Do not embed raw source rows into canonical
  release exports.
- Prefer stable unauthenticated public endpoints over browser automation or private access.
- If the source is ambiguous, create review work. Do not hide the ambiguity in normalization code.

## Minimal Flow

1. Define the source metadata and endpoint capture plan.
2. Fetch a public fixture and add or update fixture coverage.
3. Normalize typed items, candidates, legal refs, and datasets.
4. Add or update review items only where the source truly needs a human decision.
5. Run the relevant tests, then a human-perspective CLI smoke on a temp workbench.
