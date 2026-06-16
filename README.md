> [!IMPORTANT]
> Active development for the ledger rewrite is happening on [`next/ledger`](https://github.com/natemergler/dc_scraper/tree/next/ledger). Start there for the current direction; `main` is the older DC Data CLI snapshot.

> [!WARNING]
> Vibe-coded and partially tested. Do not assume anything here works.

# DC Data CLI

This repo is a maintainer-first local CLI for D.C. civic structure data. It fetches public sources,
normalizes typed candidates into a SQLite file, records replayable JSONL decisions when resolution
is needed, and builds a compact public release package.

```text
source connector -> local artifact -> SQLite workbench -> audit -> browse -> decide when needed -> release package
```

Local state lives under `data/`, `resolutions/`, and `releases/`.

```bash
WORKBENCH_DB=data/workbench.sqlite
WORKBENCH_ARTIFACTS=data/v2_artifacts
FRESH_RELEASE_DIR=releases/fresh-smoke

deno task ok
deno task dc -- init --db "$WORKBENCH_DB"
deno task dc -- source list --db "$WORKBENCH_DB"
deno task dc -- source fetch --all --db "$WORKBENCH_DB" --data-dir "$WORKBENCH_ARTIFACTS"
deno task dc -- status --db "$WORKBENCH_DB"
deno task dc -- audit --db "$WORKBENCH_DB"
deno task dc -- release verify --db "$WORKBENCH_DB"
deno task dc -- release build --source-profile custom --db "$WORKBENCH_DB" --out "$FRESH_RELEASE_DIR"
deno task dc -- release inspect --out "$FRESH_RELEASE_DIR"
```

The default workbench database is `data/workbench.sqlite`. Use `deno task dc -- source fetch --all`
when you need the full configured-source data

Use inspection commands when you want scriptable state:

```bash
deno task dc -- status --json
deno task dc -- source list --json
deno task dc -- source inspect dcgis.agencies --json
deno task dc -- source compare public-bodies --json
deno task dc -- smoke tier0 --json
deno task dc -- review packets --mode relationships --json
deno task dc -- review list --json
deno task dc -- entity search accountancy --json
deno task dc -- entity show dc.board_of_accountancy --json
deno task dc -- release verify --json
deno task dc -- release build --json
deno task dc -- release inspect --json
```

## Release Contract

`dc release build` writes a short, stable package:

- `README.md`
- `manifest.json`
- `dcgov.sqlite`
- `01_sources_and_portals.csv`
- `02_public_datasets.csv`
- `03_legal_authorities.csv`
- `entities/all_entities.csv`
- `entities/elected_and_seats.csv`
- `entities/agencies_and_offices.csv`
- `entities/boards_commissions_public_bodies.csv`
- `entities/council_committees.csv`
- `entities/courts_and_legal_bodies.csv`
- `entities/wards_ancs_smds.csv`
- `entities/roles_statuses_observations.csv`
- `relationships/all_relationships.csv`
- `relationships/structure_relationships.csv`
- `relationships/authority_relationships.csv`
- `relationships/representation_membership_relationships.csv`
- `references/entity_sources.csv`
- `references/relationship_sources.csv`
- `references/entity_legal_authorities.csv`
- `references/relationship_legal_authorities.csv`

The release SQLite database is rebuilt from whitelisted release tables and views. It is not a copy
of the full workbench database.
