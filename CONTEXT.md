# DC Civic Content Repository

This context defines the domain language for producing a contract-ready D.C. civic data release from
public and official materials.

## Language

**Contract-complete civic content**: The set of civic source, legal, unit, relationship, pipeline,
gap, and supporting source-data artifacts needed to make the release defensible against the
contract's completeness claim. _Avoid_: Tiny v1 slice, full public-data warehouse

**Release milestone**: A staged implementation checkpoint that produces a usable repo state,
regenerated artifacts, passing checks, and revised docs. _Avoid_: Phase, wave, backend milestone

**Workbench loop**: The repeated practice of using the CLI and repo artifacts to fetch, review,
curate, validate, release, and revise documentation as the project grows. _Avoid_: One-time
implementation pass, hidden project management

**Source-family lane**: A coherent group of upstream sources processed together because they share
access patterns, schemas, or civic meaning. _Avoid_: Scraper module, data silo

**Snapshot**: A saved capture of an official/public source response, including source URL, fetch
time, status, hash, and payload or failure manifest. _Avoid_: Temporary download

**Candidate**: A generated proposed record derived from a snapshot or source row. Candidates are
review inputs, not release truth. _Avoid_: Final record

**Curated record**: A maintained YAML record under `records/` that is eligible for release output.
_Avoid_: Generated candidate

**Promotion**: The explicit act of creating a curated record from a candidate without overwriting an
existing record. _Avoid_: Auto-sync

**Patch**: A deterministic correction applied to a candidate so source-derived fixes can survive
regeneration. _Avoid_: Manual release edit

**Gap**: A structured, release-visible limitation or unresolved source/modeling problem. _Avoid_:
Hidden TODO

**Check**: A generated validation or review finding with severity, artifact context, and optional
suppression. _Avoid_: Console-only warning

## Relationships

- **Contract-complete civic content** includes more than the literal minimum list of public
  **Sources** when additional source families are needed to support a defensible release.
- **Contract-complete civic content** is delivered through staged implementation, but the
  implementation plan must describe the larger source-acquisition and processing path beyond the
  first v1 slice.
- A **Release milestone** advances one or more **Source-family lanes** only when doing so improves
  the generated release, checks, caveats, or review workflow.
- The **Workbench loop** happens inside each **Release milestone**, not after the implementation is
  finished.

## Example Dialogue

> **Dev:** "Does 'contract complete' mean only the first thin v1 slice?" **Domain expert:** "No. It
> means **Contract-complete civic content**: a staged path from the first release slice toward the
> fuller source-acquisition and processing coverage needed for a defensible package."

> **Dev:** "Should we build all source fetchers first and use the CLI later?" **Domain expert:**
> "No. Each **Release milestone** should run the **Workbench loop** so the CLI, records, checks,
> release files, and docs improve together."

## Flagged Ambiguities

- "all the data" could mean a tiny v1 slice, a public-data warehouse, or **Contract-complete civic
  content**; resolved: this project means **Contract-complete civic content** with a staged
  implementation plan beyond the first release slice.
