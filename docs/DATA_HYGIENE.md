# Data Hygiene

Current status:

- Generated workbench data is ignored: `data/`, `resolutions/`, `snapshots/`, `candidates/`,
  `candidates_patched/`, `records/`, `checks/`, `patches/`, and `releases/`.
- The current tracked tree no longer contains the old generated data surfaces.
- Active writable branch history was best-effort rewritten for the current repository branches.
- Fresh normal clones should not expose the old generated paths from branch history.
- `src/v2/connectors/quickbase.ts` is still tracked intentionally; it is source code for a public
  civic-data connector, not a captured Quickbase artifact.

Old generated artifact paths that should not be reintroduced:

- `snapshots/**`
- `candidates/**`
- `records/**`
- `releases/**`
- `checks/**`
- `patches/**`

The old snapshots included source schemas and source rows with contact-field names such as email,
phone, fax, vendor address, and street address fields. Those belong in local workbench artifacts or
evidence storage, not in the tracked repository or compact release exports.

Accepted caveat:

GitHub-managed pull-request refs may still retain old generated objects. Do not claim a perfect
GitHub object purge, and do not attempt dangerous read-only PR-ref rewrites. Honest wording is:
current tracked tree clean, active branch history cleaned, GitHub-managed PR refs may retain old
objects.

Operator notes:

- Prefer fresh clones after the rewrite.
- Do not push from pre-rewrite local branches unless they are first rebased or recreated from the
  rewritten remote branch.
- Keep local workbench data under ignored paths.
- If a generated local workbench database fails a schema migration because old rows violate new
  integrity constraints, rebuild and refetch the ignored workbench state. Do not silently repair or
  commit generated local data.
