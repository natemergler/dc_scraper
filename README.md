# DC civic-data workbench

This repo is a maintainer-first local workbench for source-backed D.C. civic structure data. It
fetches public sources into local artifacts, normalizes typed candidates into a SQLite workbench,
records replayable JSONL review decisions, and builds a compact public release package.

The product shape is deliberately small:

```text
source connector -> local artifact -> SQLite workbench -> review JSONL -> release package
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
deno task dc -- review
deno task dc -- release verify
deno task dc -- release build --source-profile custom
deno task dc -- release inspect
```

The default workbench database is `data/workbench.sqlite`.

## Happy Path

Use one real fetch, one real review, and one real release:

```bash
deno task dc -- source fetch dcgis.agencies --limit 25
deno task dc -- source inspect dcgis.agencies
deno task dc -- review
deno task dc -- entity search accountancy
deno task dc -- release verify
deno task dc -- release build --source-profile custom
deno task dc -- release inspect
```

`dc review` is the main human path. It now opens with a ranked decision inbox for the current slice.
Press Enter for the recommended packet or choose another packet from the list, then review the
current item, its default action, and the exact evidence behind that default. Once you enter a
packet, `dc review` stays inside it until it clears or you quit. Quit is safe; rerun `dc review` to
resume.

## Review And Smoke

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
- `deno task dc -- audit` shows blocked reconciliation details when status alone is not enough.
- `deno task dc -- release verify` fails fast when release work is still unresolved, source artifact
  provenance is not clean, or release rows no longer trace to source-backed decisions or references.

## Current Docs

- [DESIGN.md](DESIGN.md) is the live architecture note for the v2 model.
- [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) is the maintainer workflow.
- [docs/CONNECTOR_AUTHORING.md](docs/CONNECTOR_AUTHORING.md) is the contributor seam for source
  work.
- [docs/RELEASE_CONTRACT.md](docs/RELEASE_CONTRACT.md) is the public package contract.
- [docs/SOURCE_COVERAGE.md](docs/SOURCE_COVERAGE.md) is the operator view of current source lanes.

Historical planning notes still exist under `notes/`, but they are implementation history, not the
current truth surface.

## Privacy Boundary

Public civic names, offices, roles, statuses, source URLs, and legal citations are in scope.
Personal contact details are out of scope: emails, phone numbers, home addresses, contact fields,
private notes, and contact metadata should stay out of release exports.
