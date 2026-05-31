# DC Civic Content Repository

File-backed D.C. civic content workbench for sources, legal materials, civic units, relationships,
pipelines, gaps, checks, and generated release packages.

The repo is the database. Curated YAML records under `records/` are the release source of truth.
Generated candidates under `candidates/` are review inputs and never silently overwrite curated
records.

Current Tier 1 coverage snapshots DCGIS agency tables, DC legal/regulatory publication manifests,
Council LIMS and HMS JSON API manifests, Council hearings and oversight/budget schedule pages, D.C.
Courts, OCFO publication pages, BOE publication pages, and ANC reference pages and ANC resolution
metadata. The Enterprise Dataset Inventory is covered as source-discovery metadata. PASS
procurement, payment, forecast, contract, solicitation, and solicitation-attachment tables are
covered with metadata-only ArcGIS snapshots, as are 311, crime, permit, and business-license feeds.
SCOUT and PropertyQuest have page manifests plus explicit gaps for deferred API/deep-ingest work.

## Quick Start

```bash
deno task test
deno task validate
deno task generate-checks
deno task build-release
deno task dc -- review next
```

The latest generated package is under `releases/latest/`.

For a handoff or contract-deliverable review, run `deno task dc -- release inspect` first. Then
inspect `releases/latest/manifest.json`, `releases/latest/caveats.md`, `checks/latest.md`, and
`deno task dc -- sources audit`. Page manifests prove current official entry-page evidence; they do
not imply deep API, document, or row extraction unless a specific pipeline says so.

## Main Commands

```bash
deno task dc -- seed baseline
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
deno task dc -- patch draft dc.alcoholic.beverage.and.cannabis.administration
deno task dc -- patch activate patch.dc_alcoholic_beverage_and_cannabis_administration
deno task dc -- patch apply
deno task dc -- promote --all-new --source dcgis
deno task dc -- records explain dc.mayor
deno task dc -- gaps list
deno task dc -- gaps show current_officeholders_deferred
deno task dc -- release inspect
```

JSON release files are the faithful structured output. CSV files are flattened convenience views and
are lossy for nested fields.
