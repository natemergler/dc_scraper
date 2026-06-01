# DC civic-data workbench

This is a local Deno workbench for source-backed D.C. civic structure data. It fetches public
sources into local artifacts, indexes normalized evidence in SQLite, helps a reviewer accept or
defer candidate facts, records replayable JSONL decisions, and builds a compact release package.

Local workbench state lives under `data/`, `resolutions/`, and `releases/`. Those paths are ignored.
Do not commit raw source captures, generated candidates, or workbench databases.

## Setup

```bash
deno task ok
deno task dc -- init
deno task dc -- status
```

The default database is `data/workbench.sqlite`.

## Common Flow

```bash
deno task dc -- source list
deno task dc -- source fetch dcgis.agencies --limit 25
deno task dc -- source inspect dcgis.agencies
deno task dc -- review
deno task dc -- entity search accountancy
deno task dc -- release build
deno task dc -- release inspect
```

`dc review` is the main human path. It shows evidence, a default action, and single-key choices for
accept, edit, reject, defer, or quit.

## Release Shape

`dc release build` writes:

- `README.md`
- `manifest.json`
- `dcgov.sqlite`
- `entities.csv/json`
- `relationships.csv/json`
- `sources.csv/json`
- `datasets.csv/json`
- `legal_refs.csv/json`

The release SQLite database is built from whitelisted release tables and views. It is not a copy of
the full workbench database.

## Privacy Boundary

Public civic names, offices, roles, statuses, source URLs, and legal citations are in scope.
Personal contact details are out of scope: emails, phone numbers, home addresses, contact fields,
private notes, and contact metadata should stay out of release exports.

Historical generated source captures existed in prior commits. If this branch is promoted, reachable
Git history and remote refs still need a coordinated purge before treating the repository as clean
of old raw artifacts.
