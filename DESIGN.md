# Design

The workbench has one path:

```text
source connector -> local artifact -> SQLite workbench -> review JSONL -> release package
```

Source data is untrusted at connector boundaries. Connectors fetch practical artifacts, parse only
the fields they understand, normalize into typed candidate rows, and preserve evidence for review.
Raw rows belong in local artifacts or evidence tables, not in release exports.

SQLite is the local workbench. It stores source inventory, artifacts, source items, candidates,
review items, resolution events, canonical entities, relationships, datasets, and legal refs.

Resolution JSONL files are the replayable decision log. Common review decisions should be written by
the CLI, not hand-edited.

The release is intentionally boring. CSV and JSON files expose compact entities, directed
relationships, source inventory, dataset inventory, and legal refs. `dcgov.sqlite` is rebuilt from a
whitelist of release tables/views and excludes workbench internals such as raw source items,
candidates, review items, evidence tables, artifacts, and resolution events.

Generated local state is ignored:

```text
data/
resolutions/
releases/
snapshots/
candidates/
candidates_patched/
records/
checks/
patches/
```

Normal verification:

```bash
deno task ok
```
