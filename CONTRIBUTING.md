# Contributing

Thanks for helping on the D.C. civic-data workbench.

## Before You Change Code

1. Read [README.md](README.md), [DESIGN.md](DESIGN.md), and the short doc in the area you are
   touching.
2. Keep scope tight. This repo prefers deepening the current v2 workbench over widening into broad
   new source coverage.
3. Use temp-workbench tests and fixture coverage before live-source validation.

## Expected Change Shape

- Keep `Workbench` thin.
- Keep source data untrusted until it has been normalized into typed rows.
- Preserve evidence instead of silently guessing through ambiguity.
- Keep release output compact, privacy-safe, and source-backed.

## Required Checks

Run the relevant targeted tests while you work, then run the full gate before a major handoff:

```bash
deno task ok
```

For source work, also run a human-perspective smoke on a temp workbench when the flow is meaningful:

```bash
deno task dc -- smoke structure
```

## Connector Changes

Connector work should include:

- fixture coverage
- source metadata (`tier`, `releaseRole`, `smokeProfiles`, `privacyNotes`)
- an explicit privacy statement
- an explicit release-surface statement

See [docs/CONNECTOR_AUTHORING.md](docs/CONNECTOR_AUTHORING.md).
