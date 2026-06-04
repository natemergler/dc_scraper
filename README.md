# DC civic-data workbench

This repo is a maintainer-first local workbench for source-backed D.C. civic structure data. It
fetches public sources into local artifacts, normalizes typed candidates into a SQLite workbench,
records replayable JSONL decisions when resolution is needed, and builds a compact public release
package.

The product shape is deliberately small:

```text
source connector -> local artifact -> SQLite workbench -> audit/review -> release package
```

Local state lives under `data/`, `resolutions/`, and `releases/`. Those paths are ignored. Do not
commit raw captures, generated candidates, or workbench databases.

## Who This Is For

- A maintainer who wants a trustworthy local review surface for D.C. civic structure.
- A contributor who wants to add or debug one source lane without learning hidden repo lore.
- A release consumer who wants a boring, self-explanatory package instead of a workbench dump.

## Five-Minute Path

```bash
deno task ok
deno task dc -- init
deno task dc -- source list
deno task dc -- source fetch dcgis.agencies --limit 25
deno task dc -- status
deno task dc -- audit
deno task dc -- release verify
deno task dc -- release build --source-profile custom
deno task dc -- release inspect
```

The default workbench database is `data/workbench.sqlite`. The `--limit 25` fetch is a small slice
for orientation. Use `deno task dc -- source fetch --all` when you need the full configured-source
workbench. A full fetch can take a while because it walks several public source lanes; expect
per-source progress and a final succeeded/failed summary before moving on.

## Happy Path

Use one real fetch, one audit/browse pass, and one real release:

```bash
deno task dc -- source fetch --all
deno task dc -- source inspect dcgis.agencies
deno task dc -- status
deno task dc -- audit
deno task dc -- entity search accountancy
deno task dc -- release verify
deno task dc -- release build --source-profile custom
deno task dc -- release inspect
```

For long all-source runs, let the fetch reach its final summary before treating the workbench as
current. Use a single-source fetch or a smoke profile when you only need a quick operator check.

`dc review` is the human path for true ambiguity, conflicts, edits, rejects, and deferrals. Safe
materialized facts should be audited, browsed, verified, and released without turning them into
manual queue work. When review is needed, it opens with a ranked decision inbox for the current
slice. Press Enter for the recommended packet or choose another packet from the list, then inspect
the evidence and decide. Quit is safe; rerun `dc review` to resume.

## Inspect And Smoke

Use the temp-workbench smoke profiles when you want a clean operator rehearsal:

```bash
deno task dc -- smoke tier0
deno task dc -- smoke structure
deno task dc -- smoke inventory
```

Use the inspection seams when you want scriptable state:

```bash
deno task dc -- status --json
deno task dc -- source list --json
deno task dc -- source inspect dcgis.agencies --json
deno task dc -- review packets --mode relationships --json
deno task dc -- review list --json
deno task dc -- entity show dc.board_of_accountancy --json
deno task dc -- release inspect --json
```

`status`, `audit`, `review packets`, `review list`, and `entity show` are the main browse surfaces
for unresolved, stale, or blocked work before opening interactive review.

## Release Contract

`dc release build` writes a short, stable package:

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

The release SQLite database is rebuilt from whitelisted release tables and views. It is not a copy
of the full workbench database.

## How To Know It Is Healthy

- `deno task dc -- status` shows the current work queue and the next suggested command.
- `deno task dc -- audit` shows blocked reconciliation and review reasons when status alone is not
  enough.
- `deno task dc -- release verify` fails fast when release work is still unresolved, source artifact
  provenance is not clean, or release rows no longer trace to source-backed decisions or references.
- `deno task dc -- release inspect` checks the built package on disk against the manifest and
  reports package integrity plus release readiness.

## Current Docs

- [DESIGN.md](DESIGN.md) is the live architecture note for the v2 model.
- [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) is the maintainer workflow.
- [docs/CONNECTOR_AUTHORING.md](docs/CONNECTOR_AUTHORING.md) is the contributor seam for source
  work.
- [docs/RELEASE_CONTRACT.md](docs/RELEASE_CONTRACT.md) is the public package contract.
- [docs/SOURCE_COVERAGE.md](docs/SOURCE_COVERAGE.md) is the operator view of current source lanes.
- [docs/DATA_HYGIENE.md](docs/DATA_HYGIENE.md) is the generated-data and privacy boundary note.

Historical planning notes still exist under `notes/`, but they are implementation history, not the
current truth surface.

## Privacy Boundary

Public civic names, offices, roles, statuses, source URLs, and legal citations are in scope.
Personal contact details are out of scope: emails, phone numbers, home addresses, contact fields,
private notes, and contact metadata should stay out of release exports.
