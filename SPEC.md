# Spec

This repository produces a structured D.C. civic content release package.

Required release files:

- `manifest.json`
- `public_sources.csv` / `public_sources.json`
- `legal_materials.csv` / `legal_materials.json`
- `civic_units.csv` / `civic_units.json`
- `relationship_types.csv` / `relationship_types.json`
- `relationships.csv` / `relationships.json`
- `update_pipelines.csv` / `update_pipelines.json`
- `gaps.csv` / `gaps.json`
- `checks_summary.json`
- `README.md`
- `caveats.md`

Core invariants:

- Curated records are one YAML file per record under `records/`.
- Record IDs must match file paths.
- Generated candidates do not overwrite curated records.
- Patches apply to candidates, not directly to releases.
- Unsuppressed error checks block release builds.
- Gaps and caveats are part of the deliverable when uncertainty matters.
- Bulky raw snapshots must be surfaced by checks rather than silently becoming normal repo content.
- Required source snapshots must be periodically reverified; stale source evidence is a check.

Current implementation covers the first official-registry lane with live DCGIS agency and
boards/commissions/councils snapshots, broad generated civic-unit candidates, explicit promotion,
checks, release generation, explanation, review, and patch primitives. It also manifests Tier 1
legal, regulatory, OCFO, BOE, Council hearings and oversight/budget schedule, D.C. Courts, and ANC
publication/reference pages, ANC resolution metadata, plus Council LIMS and HMS JSON API endpoint
manifests. The Enterprise Dataset Inventory is covered as source-discovery metadata. PASS
procurement/payment/solicitation tables and operational 311, crime, permit, and business-license
feeds are covered as metadata-only ArcGIS snapshots with row counts and schema baselines. Snapshot
references are carried into the release manifest. SCOUT and PropertyQuest are page-manifested while
their API/deep-ingest lanes remain explicit release caveats.

Candidate review now includes show/diff commands, patch drafting as YAML artifacts, activation, and
active patch replay into `candidates_patched/`.

Source health now includes Tier 1 baselines and snapshot-to-baseline comparisons for publication
manifest link/asset changes, JSON API endpoint changes, source-kind changes, and ArcGIS table field
changes.

Check generation also enforces source freshness and the local raw snapshot size policy so future
deeper source lanes keep current evidence in view and large payloads out of the hand-maintained repo
unless they are deliberately promoted.

Generated checks are not the same thing as release caveats. A clean check summary means no detected
validation, freshness, fetch, or drift problem in the current artifacts. Open release-relevant gaps
remain visible in `gaps.*`, `caveats.md`, and `dc review next`.
