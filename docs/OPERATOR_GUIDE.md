# Operator Guide

This is the maintainer path for running the v2 workbench without guessing which command matters
next.

## Setup

```bash
deno task ok
deno task dc -- init
deno task dc -- status
```

## Fetch

Start small when you are debugging one lane:

```bash
deno task dc -- source list
deno task dc -- source fetch dcgis.agencies --limit 25
deno task dc -- source inspect dcgis.agencies
```

Fetch every configured source when you need a full workbench refresh:

```bash
deno task dc -- source fetch --all
```

An all-source fetch may take a while. The command prints progress as source lanes run and ends with
a succeeded/failed summary; wait for that final summary before opening review or building a release.

Use the metadata-driven smoke profiles when you want a fresh temp-workbench pass:

```bash
deno task dc -- smoke tier0
deno task dc -- smoke structure
deno task dc -- smoke inventory
```

Smoke profiles always create a fresh temp workspace and print the DB path they used. Use
`source fetch --all --db <path> --data-dir <path>` when you need to fetch into explicit local paths.

## Audit And Review

Check the current state before opening the manual decision inbox:

```bash
deno task dc -- status
deno task dc -- audit
deno task dc -- entity search accountancy
deno task dc -- entity show dc.board_of_accountancy
```

Safe materialized facts are not manual queue work. Browse them with `status`, `audit`, entity
commands, and release verification. Use the manual path when those surfaces point at true ambiguity,
conflicts, edits, rejects, or deferrals:

```bash
deno task dc -- review
```

Useful secondary seams:

```bash
deno task dc -- review packets --mode relationships
deno task dc -- review list --mode relationships --limit 10
deno task dc -- review batch accept-safe --mode entities --subject-prefix candidate.dcgis.boards_commissions_councils
```

`review packets`, `review list`, and `entity show` are browse surfaces for unresolved, stale, or
blocked work. Use `dc review` when a packet needs an actual decision.

`dc review` opens with a ranked decision inbox for the current slice. Press Enter for the
recommended packet or choose another ranked packet, then inspect evidence, accept, edit, reject,
defer, or quit and resume deliberately. Once you enter a packet, `dc review` stays inside it until
it clears or you quit.

## Release

Before building a release, verify the current workbench state:

```bash
deno task dc -- release verify
```

Build and inspect:

```bash
deno task dc -- release build --source-profile custom
deno task dc -- release inspect
```

`release verify` checks workbench readiness and source-backed provenance before build.
`release inspect` checks the built package on disk against the manifest and reports package
integrity plus release readiness.

## Health

- `dc status` answers "what is left?"
- `dc audit` answers "what is blocked and why?"
- `dc release verify` answers "is this workbench ready to hand off, and do accepted release rows
  still trace to source-backed decisions?"
- `dc release inspect` answers "does the built release package still match its manifest?"

If a command fails, keep the smallest real surface in mind: inspect one source, one review slice, or
one release verification reason before widening again.
