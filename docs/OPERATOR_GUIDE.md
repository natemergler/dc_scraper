# Operator Guide

This is the maintainer path for running the local workbench without guessing which command matters
next.

## Setup

```bash
WORKBENCH_DB=data/workbench.sqlite
WORKBENCH_ARTIFACTS=data/v2_artifacts

deno task ok
deno task dc -- init --db "$WORKBENCH_DB"
deno task dc -- status --db "$WORKBENCH_DB"
```

## Fetch

Start small when you are debugging one lane:

```bash
deno task dc -- source list --db "$WORKBENCH_DB"
deno task dc -- source fetch dcgis.agencies --limit 25 --db "$WORKBENCH_DB" --data-dir "$WORKBENCH_ARTIFACTS"
deno task dc -- source inspect dcgis.agencies --db "$WORKBENCH_DB"
```

Fetch every configured source when you need a full workbench refresh:

```bash
deno task dc -- source fetch --all --db "$WORKBENCH_DB" --data-dir "$WORKBENCH_ARTIFACTS"
```

An all-source fetch may take a while. The command prints progress as source lanes run and ends with
a succeeded/failed summary; when a lane fails, inspect the source named in the printed next command
before widening to review or release work.

Use the metadata-driven smoke profiles when you want a fresh temp-workbench pass:

```bash
deno task dc -- smoke tier0
deno task dc -- smoke structure
deno task dc -- smoke inventory
```

Smoke profiles always create a fresh temp workspace and print the DB path they used. Failed smoke
fetches print an `Inspect failed source:` command scoped to that temp workbench DB. Use
`source fetch --all --db <path> --data-dir <path>` when you need to fetch into explicit local paths.
Local workbench DBs are current-schema only: connect to a current preexisting DB, or create and
refetch a fresh one. If an ignored local DB is not current, treat it as scratch state: point `--db`
at a current workbench or delete the old DB and let `dc init` create a fresh one. Smoke text also
prints workspace-scoped `Release out:`, `Release verify:`, `Release build:`, and `Release
inspect:`
handoffs, and `smoke --json` exposes the same `releaseOutDir`, `releaseVerifyCommand`,
`releaseBuildCommand`, and `releaseInspectCommand` values plus the temp-workspace `nextCommand`.

## Audit, Browse, And Review

Check the current state before opening the manual decision inbox:

```bash
deno task dc -- status --db "$WORKBENCH_DB"
deno task dc -- audit --db "$WORKBENCH_DB"
deno task dc -- entity search accountancy --db "$WORKBENCH_DB"
deno task dc -- entity show dc.board_of_accountancy --db "$WORKBENCH_DB"
```

Safe materialized facts are not manual review work. Use `status` and `audit` for readiness,
blockers, and next commands. Browse compiled model/evidence with source inspection, entity commands,
and `review list --status all`; `status` prints a `Browse rows:` handoff when source-backed browse
rows exist and `status --json` exposes the same browse command, `source list` prints `Inspect:` and
`Fetch:` handoffs for failed or unfetched lanes, `source inspect` prints a `Browse:` handoff when
fetched rows exist, and `entity search` prints a `Show:` handoff for each result. `entity show`
prints `Next:` when open review work is attached. When `--db` is used, review list/packets and
entity search/show handoff commands stay scoped to that workbench. Use the manual path when those
surfaces point at true ambiguity, conflicts, edits, rejects, or deferrals. `release verify --json`
exposes the build command, warning review command, and public-body compare command for scripts that
need the same duplicate-risk warning handoffs, and those commands stay scoped to the verified
workbench when `--db` is used:

```bash
deno task dc -- review --db "$WORKBENCH_DB"
```

Useful secondary commands:

```bash
deno task dc -- review packets --mode relationships --db "$WORKBENCH_DB"
deno task dc -- review list --mode relationships --limit 10 --db "$WORKBENCH_DB"
deno task dc -- review list --decisions --db "$WORKBENCH_DB"
```

`review list --status all` and `entity show` are browse surfaces for unresolved, stale, or blocked
work. `review packets` and `review list --decisions` narrow the decision surface. `review packets`
prints `Next:` for the first packet, and `review list` prints `Next:` when the current slice
contains a human decision. Use `dc review` when a packet needs an actual decision.

For scriptable review handoff, `review packets --json` exposes packet summaries, review commands,
and a next command for the first packet. `review list --json` exposes item summaries, source IDs,
labels, review commands, next commands, and decision/browse counts. `source compare public-bodies`
prints `Next:` for the first unresolved conservative variant lead;
`source compare public-bodies --json` exposes review commands for unresolved conservative leads,
`releaseRiskVariantMatchCount` for the accepted duplicate-risk subset, and a next command for the
first review handoff. When `--db` is used, source list/inspect/fetch/compare handoff commands stay
scoped to that workbench. `entity search --json` exposes show commands for moving from search
results to entity inspection. `entity show --json` exposes review commands and a next command on
source-backed review items. `status --json` and `audit --json` expose blocked-source inspect
commands for reconciliation lanes that need source inspection, and those status/audit handoff
commands stay scoped to the active workbench when `--db` is used. `release verify --json` exposes
warning reasons separately from hard blocker reasons, exposes a `buildCommand` when the workbench is
buildable, and only accepted public-body duplicate-risk leads trigger the compare-command warning
handoff. When `release verify` is run against a non-default workbench, those handoff commands keep
the same `--db` scope.

Malformed legal labels can show official suggestions without becoming accepted facts. Treat those
suggestions as review evidence: normalize or accept only when the source-backed evidence supports
the decision.

Advanced/scriptable maintenance commands such as `review batch accept-safe` and
`review batch defer-default` remain available after inspecting a narrow packet/list slice, but they
are not the normal human review path. Batch commands print `Next:` to send the operator back through
status after writing decisions.

`dc review` opens with a ranked decision inbox for the current slice. Press Enter for the
recommended packet or choose another ranked packet, then inspect evidence, accept, edit, reject,
defer, or quit and resume deliberately. Once you enter a packet, `dc review` stays inside it until
it clears or you quit.

## Release

Before building a release, verify the current workbench state:

```bash
WORKBENCH_DB=<db path printed by smoke, or your fetch workspace DB>
FRESH_RELEASE_DIR=releases/fresh-smoke

deno task dc -- release verify --db "$WORKBENCH_DB"
```

Build and inspect:

```bash
deno task dc -- release build --source-profile custom --db "$WORKBENCH_DB" --out "$FRESH_RELEASE_DIR"
deno task dc -- release inspect --out "$FRESH_RELEASE_DIR"
```

`release verify` checks source-backed provenance and release blockers before build. Open or deferred
review decisions are warning reasons, not hard blocker reasons, when the accepted release rows still
trace cleanly to source-backed workbench decisions. `release verify` prints a review-warning handoff
for inspecting those warning-level items without changing the release-build next step. The release
inspection command checks the built package on disk against the manifest and reports package
integrity, release readiness reasons, and the built package summary.

## Health

- `dc status` answers "what is left?"
- `dc audit` answers "what is blocked and why?"
- `dc release verify` answers "do accepted release rows still trace to source-backed decisions, and
  are there provenance or blocker problems?"
- `dc release inspect` answers "does the built release package still match its manifest?" Use
  `dc release inspect --json` when you need structured package-integrity, blocking readiness
  reasons, warning reasons, warning-review handoff, browse handoff, source-inspect handoff, next
  command, and release-summary details from the manifest.

If a command fails, keep the smallest real surface in mind: inspect one source, one review slice, or
one release verification reason before widening again.
