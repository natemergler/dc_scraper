# Civic Ledger

DC civic structure data as individual GitHub release files, led by CSV tables.

## Download Tables

- Elected officials: `dc_councilmembers.csv`
- Agencies and offices: `dc_agencies.csv`, `dc_offices.csv`
- Boards and commissions: `dc_public_bodies.csv`, `dc_public_body_affiliations.csv`
- Council committees: `dc_council_committees.csv`, `dc_council_committee_memberships.csv`
- Geography: `dc_wards.csv`, `dc_ancs.csv`, `dc_smds.csv`
- Courts, law, sources, links: `dc_courts.csv`, `dc_legal_authorities.csv`, `dc_sources.csv`,
  `dc_relationships.csv`

Each GitHub release uploads 21 files: 14 public CSVs, `ledger.sqlite`, `govgraph_nodes.json`,
`govgraph_edges.json`, `govgraph_summary.json`, `manifest.json`, the generated release `README.md`,
and `SHA256SUMS`.

## Notes

- Blank cells mean no current source-backed value.
- Contacts, staff bios, meetings, budgets, procurement, permits, property, public safety, elections,
  full law text, legal advice, and full LIMS coverage are out of scope.
- Public-body near-duplicates stay distinct unless a tracked merge or suppression says otherwise.

## Maintainer Loop

```text
deno task ok
deno task civic state generate
deno task civic check
deno task civic export
deno task civic release verify releases/latest
```
