# DC Civic Data Workbench Context

This repo builds a local, source-backed D.C. civic data workbench and a clean release package.

## Language

**Workbench database**: The local SQLite database under `data/` that indexes sources, artifacts,
evidence, candidates, review items, resolutions, and canonical civic facts. _Avoid_: YAML database,
release database

**Source artifact**: A local fetched file captured from an official or public source. It may be a
page, schema, sample rows, full rows, document index, CSV, or JSON response. _Avoid_: Committed raw
data

**Candidate**: A normalized proposed entity, relationship, dataset, or legal reference derived from
source evidence. Candidates require review before becoming release facts. _Avoid_: Final record

**Review item**: A workbench prompt that tells a reviewer what needs attention, why it matters, what
evidence exists, and what default action is likely. _Avoid_: Hidden TODO

**Resolution event**: A replayable JSONL decision written by the CLI, such as accepting or rejecting
a candidate, merging entities, setting canonical fields, or deferring review. _Avoid_: Text diff

**Canonical entity**: A compact reviewed civic body, office, role, committee, board, dataset owner,
or other public civic unit in the workbench. _Avoid_: Contact entry

**Directed relationship fact**: One stored relationship from a source entity to a target entity.
Incoming/backlink views are generated for display and query. _Avoid_: Duplicated inverse fact

**Release package**: The generated public output under `releases/`, containing only whitelisted
CSV/JSON files, one short README, a manifest, and a release SQLite database. _Avoid_: Workbench dump

**Privacy boundary**: The rule that public civic facts are allowed, while personal contact details
and contact-directory fields are excluded from releases. _Avoid_: Contact directory
