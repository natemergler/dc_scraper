# Alpha release scope

The alpha release is a reproducible checkpoint from committed state to generated release artifacts,
not a proof that live public sources can be freshly collected into identical state. Its artifact
surface is limited to established state-derived facts: generic ledger files, SQLite, source
coverage, DC-specific civic views, and a bounded legal authority slice for explicit D.C. Code,
Mayor's Order, and D.C. Law locators already present in source-derived citations. Review queues,
diagnostics, broader legal-source modeling, product demos, and civlab.org integration remain outside
the alpha release scope so the checkpoint can finish without pretending to be a complete civic or
legal database. Alpha legal authority entries use one `dc.legal_authority` kind with
`dc.legal_authority:*` canonical IDs and type/locator attributes, deferring separate legal sub-kinds
until the broader legal model is mature enough to justify them. Alpha legal authority links use
`dc.relation:authorized_by` from civic entries to legal authority entries because the current source
locators are explicit but do not yet justify finer legal relation semantics. For alpha, these
entries and links are derived centrally from entry citations rather than emitted by each
interpreter, keeping legal-authority derivation local to the compiler and avoiding hidden curation
in source readers or interpreters.

The alpha DC-specific release views explicitly include board, commission, and authority affiliation
CSVs, ANC/SMD structure, and Council committee membership. These views are duplicated into
`ledger.sqlite` as query-ready tables and counted in `manifest.json` so evaluators do not have to
reconstruct common public-facing civic slices from raw relation rows.
