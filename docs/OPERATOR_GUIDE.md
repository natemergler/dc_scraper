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

Use the metadata-driven smoke profiles when you want a fresh temp-workbench pass:

```bash
deno task dc -- smoke tier0
deno task dc -- smoke structure
deno task dc -- smoke inventory
```

## Review

The primary human path is still:

```bash
deno task dc -- review
```

Useful secondary seams:

```bash
deno task dc -- review packets --mode relationships
deno task dc -- review list --mode relationships --limit 10
deno task dc -- review batch accept-safe --mode entities --subject-prefix candidate.dcgis.boards_commissions_councils
deno task dc -- audit
```

`dc review` is the whole human decision layer, not just a conflict fixer. It opens with a ranked
decision inbox for the current slice. Press Enter for the recommended packet or choose another
ranked packet, then inspect evidence, accept, edit, reject, defer, or quit and resume deliberately.
Once you enter a packet, `dc review` stays inside it until it clears or you quit.

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

## Health

- `dc status` answers "what is left?"
- `dc audit` answers "what is blocked and why?"
- `dc release verify` answers "is this workbench ready to hand off, and do accepted release rows
  still trace to source-backed decisions?"

If a command fails, keep the smallest real surface in mind: inspect one source, one review slice, or
one release verification reason before widening again.
