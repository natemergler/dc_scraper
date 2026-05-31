# Workbench

Normal lifecycle:

```text
official/public source -> snapshot -> candidate -> promotion/patch -> curated record -> checks -> release
```

Use `dc review next` as the front door:

```bash
deno task dc -- review next
```

Useful loops:

```bash
deno task dc -- fetch source dcgis.agencies
deno task dc -- fetch source dcgis.boards_commissions_councils
deno task dc -- fetch source council_lims
deno task dc -- fetch source council_hms
deno task dc -- fetch source council_oversight_budget_schedules
deno task dc -- fetch source dc_courts
deno task dc -- fetch source scout
deno task dc -- fetch source propertyquest
deno task dc -- fetch tier1
deno task dc -- sources coverage
deno task dc -- sources audit
deno task dc -- sources baseline
deno task dc -- sources health
deno task dc -- candidates generate
deno task dc -- candidates show candidate.dcgis.agencies.1001
deno task dc -- candidates diff candidate.dcgis.agencies.1001
deno task dc -- promote --all-new --source dcgis --dry-run
deno task dc -- promote --all-new --source dcgis
deno task dc -- patch draft dc.alcoholic.beverage.and.cannabis.administration
deno task dc -- patch activate patch.dc_alcoholic_beverage_and_cannabis_administration
deno task dc -- patch apply
deno task dc -- gaps list
deno task dc -- gaps show current_officeholders_deferred
deno task generate-checks
deno task build-release
deno task dc -- release inspect
```

Write commands create visible repo artifacts. There is no hidden workflow database.

Open warnings should become one of: a record edit, patch, suppression, gap, or deliberate caveat.
Use `gaps list` and `gaps show <gap-id>` when the review queue surfaces a known limitation instead
of a code or data error.

Source health compares the current snapshots to committed baselines. For DCGIS tables it watches
schema fields and row counts; for publication manifests, including Council hearings,
oversight/budget schedules, D.C. Courts, SCOUT, and PropertyQuest, it watches links and page assets;
for Council LIMS/HMS JSON API manifests it watches endpoint ids and source-kind changes.

Use `sources audit` when you need one screen with the source status, health status, item count,
latest fetch date, snapshot path, and baseline path.

Clean generated checks do not mean the release has no limitations. Checks report validation,
freshness, fetch failure, and source-drift problems. Gap records and `releases/latest/caveats.md`
report known release limits such as current officeholders, legal-authority normalization, and
deferred SCOUT/PropertyQuest deep extraction.

Enterprise Dataset Inventory, PASS, and operational ArcGIS feeds use metadata-only snapshots. They
track row counts and fields for source discovery, procurement/payment/solicitation, 311, crime,
permit, and business-license sources without committing raw rows; deeper candidate generation, delta
ingestion, or row-level ingestion belongs in a later source-processing lane.

SCOUT and PropertyQuest are intentionally still gap-tracked for API/deep-ingest work, but their
official entry pages are page-manifested and diffed so the release has current source evidence for
the deferred lane.

For contract review, start with `deno task dc -- release inspect`, then inspect
`releases/latest/manifest.json`, `releases/latest/caveats.md`, `checks/latest.md`, and
`deno task dc -- sources audit`. Treat page manifests as entry-page evidence, metadata-only ArcGIS
snapshots as schema/row-count evidence, and JSON API manifests as endpoint evidence; none of those
claim full row/document extraction unless a later lane adds it.

ANC resolutions are captured through the portal JSON manifest. The current snapshot records the
default two-year resolution list and attachment metadata; deeper attachment downloads can wait until
that lane needs parsed documents.

Source freshness and raw snapshot size are also checked during `checks generate`. The default
freshness window is 30 days for required source snapshots, and the default local size limit is 5 MiB
per `snapshots/**/latest.json`. Set `DC_SOURCE_STALE_DAYS` or `DC_SNAPSHOT_SIZE_LIMIT_BYTES` only
for tests or one-off local policy experiments. Oversized raw snapshots should become smaller
manifests, deliberate fixtures, or external artifacts before they are treated as normal repo
content.
