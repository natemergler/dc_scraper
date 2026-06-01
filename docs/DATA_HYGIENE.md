# Data Hygiene

Current target branch:

- Generated workbench data is ignored: `data/`, `resolutions/`, `snapshots/`, `candidates/`,
  `checks/`, and `releases/`.
- Tracked generated data was removed in this sweep.
- `src/v2/connectors/quickbase.ts` is still tracked intentionally; it is source code for a public
  civic-data connector, not a captured Quickbase artifact.

Reachable history still contains old generated artifacts:

- `snapshots/**`
- `candidates/**`
- `records/**`
- `releases/**`
- `checks/**`
- `patches/**`

The old snapshots include source schemas and source rows with contact-field names such as email,
phone, fax, vendor address, and street address fields. This branch removes them from the target
tree, but normal delete commits do not remove them from Git history or GitHub object storage.

Required purge before treating remote history as clean:

1. Coordinate a maintenance window and tell collaborators to stop pushing.
2. Make a mirror backup of the current remote.
3. Rewrite all refs with `git filter-repo`, removing old generated artifact paths: `snapshots`,
   `candidates`, `records`, `releases`, `checks`, and `patches`.
4. Verify with `git log --all --name-only` and targeted `git grep` over `git rev-list --all`.
5. Force-push rewritten branches and tags.
6. Ask GitHub to expire cached/unreachable objects if required.
7. Require fresh clones; old clones can reintroduce purged objects if they push.
