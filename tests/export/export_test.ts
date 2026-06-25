import { Database } from "@db/sqlite";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { closeWorkspace, initWorkspace, openWorkspace } from "../../src/workspace/workspace.ts";
import { exportReleaseArtifacts, verifyReleaseArtifacts } from "../../src/export/export.ts";
import type { ReviewItem } from "../../src/review/items.ts";

Deno.test("exportReleaseArtifacts writes all release files and expected counts", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "civic-ledger-export-test-full-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-export-result-full-" });

  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  try {
    workspace.db.run(
      "INSERT INTO snapshots (source, snapshot_key, payload) VALUES (?, ?, ?), (?, ?, ?)",
      [
        "registry",
        "snapshot-2026-01-01",
        JSON.stringify({ source: "dc", sourceType: "registry" }),
        "gazette",
        "snapshot-2026-01-02",
        JSON.stringify({ source: "dc", sourceType: "gazette" }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_entries (entry_id, jurisdiction, kind, payload) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "dc.agency:a-1",
        "dc",
        "dc.agency",
        JSON.stringify({
          family: "organization",
          kind: "dc.agency",
          name: "District Agency",
          citations: [
            {
              source: "gazette",
              sourceRecordId: "a-1",
              locator: "1",
              url: "https://example.com/a/1",
            },
          ],
          attributes: { shortName: "DA", alias: "Agency One" },
        }),
        "dc.board:b-1",
        "dc",
        "dc.board",
        JSON.stringify({
          family: "organization",
          kind: "dc.board",
          name: "City Board",
          citations: [{ uncited: true, reason: "inferred from statute" }],
          attributes: {
            shortName: "CB",
            alias: "Board One",
            enablingStatute: "DC Code § 3–1301",
            enablingStatuteUrl: "https://example.com/raw-legal-text",
          },
        }),
        "dc.commission:c-1",
        "dc",
        "dc.commission",
        JSON.stringify({
          family: "organization",
          kind: "dc.commission",
          name: "Budget Commission",
          citations: [
            {
              source: "registry",
              sourceRecordId: "c-1",
              locator: "12-5",
              url: "https://example.com/c/12-5",
            },
          ],
          attributes: { shortName: "BC", alias: "Budget" },
        }),
        "dc.authority:au-1",
        "dc",
        "dc.authority",
        JSON.stringify({
          family: "authority",
          kind: "dc.authority",
          name: "Ethics Authority",
          citations: "not-an-array",
          attributes: { shortName: "EA" },
        }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_entries (entry_id, jurisdiction, kind, payload) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "dc.anc:8F",
        "dc",
        "dc.anc",
        JSON.stringify({
          family: "organization",
          kind: "dc.anc",
          name: "ANC 8F",
          citations: [],
          attributes: {
            description: "OANC lists this as ANC 6/8F; the release keeps the DCGIS ANC 8F ID.",
            shortName: "8F",
          },
        }),
        "dc.smd:8F01",
        "dc",
        "dc.smd",
        JSON.stringify({
          family: "area",
          kind: "dc.smd",
          name: "SMD 8F01",
          citations: [],
          attributes: { sourceSmdId: "8F01" },
        }),
        "dc.anc_commissioner_seat:8F01",
        "dc",
        "dc.anc_commissioner_seat",
        JSON.stringify({
          family: "position",
          kind: "dc.anc_commissioner_seat",
          name: "Commissioner Seat for SMD 8F01",
          citations: [],
          attributes: { currentHolderName: "Nic Wilson", officerRole: "Chairperson" },
        }),
        "dc.committee:transportation",
        "dc",
        "dc.committee",
        JSON.stringify({
          family: "organization",
          kind: "dc.committee",
          name: "Committee on Transportation",
          citations: [],
          attributes: { committeeType: "standing" },
        }),
        "dc.councilmember:jane-doe",
        "dc",
        "dc.councilmember",
        JSON.stringify({
          family: "person",
          kind: "dc.councilmember",
          name: "Jane Doe",
          citations: [],
          attributes: {},
        }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_entries (entry_id, jurisdiction, kind, payload) VALUES (?, ?, ?, ?)",
      [
        "dc.legal_authority:d-c-code-3-1301",
        "dc",
        "dc.legal_authority",
        JSON.stringify({
          family: "legal",
          kind: "dc.legal_authority",
          name: "D.C. Code § 3-1301",
          citations: [],
          attributes: {
            authorityType: "dc_code",
            locator: "D.C. Code § 3-1301",
            canonicalUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/3-1301",
          },
        }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_relations (from_entry_id, relation_kind, to_entry_id, citations) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "dc.board:b-1",
        "dc.relation:governs",
        "dc.agency:a-1",
        JSON.stringify([
          {
            source: "registry",
            sourceRecordId: "rel-b-1",
            locator: "5",
            url: "https://example.com/r/1",
          },
        ]),
        "dc.commission:c-1",
        "dc.relation:affiliated_with",
        "dc.agency:a-1",
        JSON.stringify([
          { uncited: true, reason: "pending review" },
        ]),
        "dc.authority:au-1",
        "dc.relation:governs",
        "dc.agency:a-1",
        JSON.stringify([
          { source: "gazette", sourceRecordId: "rel-au-1" },
          { source: "registry", sourceRecordId: "rel-au-2", url: "https://example.com/r/2" },
        ]),
        "dc.board:b-1",
        "dc.relation:oversees",
        "dc.commission:c-1",
        JSON.stringify([]),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_relations (from_entry_id, relation_kind, to_entry_id, citations) VALUES (?, ?, ?, ?)",
      [
        "dc.board:b-1",
        "dc.relation:authorized_by",
        "dc.legal_authority:d-c-code-3-1301",
        JSON.stringify([
          {
            source: "registry",
            sourceRecordId: "law-3-1301",
            url: "https://example.com/raw-legal-text",
          },
        ]),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_relations (from_entry_id, relation_kind, to_entry_id, citations) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "dc.anc:8F",
        "dc.relation:contains",
        "dc.smd:8F01",
        JSON.stringify([{ source: "registry", sourceRecordId: "smd-8F01" }]),
        "dc.anc_commissioner_seat:8F01",
        "dc.relation:represents",
        "dc.smd:8F01",
        JSON.stringify([{ source: "registry", sourceRecordId: "smd-8F01" }]),
        "dc.councilmember:jane-doe",
        "dc.relation:chairs",
        "dc.committee:transportation",
        JSON.stringify([{ source: "registry", sourceRecordId: "committee-transportation" }]),
        "dc.councilmember:jane-doe",
        "dc.relation:member_of",
        "dc.committee:transportation",
        JSON.stringify([{ source: "registry", sourceRecordId: "committee-transportation" }]),
      ],
    );

    await Deno.writeTextFile(join(releaseRoot, "entries.csv"), "stale\n");
    await Deno.writeTextFile(join(releaseRoot, "dc_council_committee_membership.csv"), "stale\n");

    const result = await exportReleaseArtifacts({
      workspace,
      jurisdiction: "dc",
      releaseRoot,
      sourceCatalog: [
        {
          source: "gazette",
          sourceType: "fixture.gazette",
          family: "legal",
          publisher: "Fixture Gazette",
          accessMethod: "Fixture feed",
          sourceUrl: "https://example.com/gazette",
          catalogConfidence: "high",
          scope: "Gazette fixture scope.",
          contributes: "Entry citations.",
          excludes: "Contacts.",
        },
        {
          source: "registry",
          sourceType: "fixture.registry",
          family: "registry",
          publisher: "Fixture Registry",
          accessMethod: "Fixture table",
          sourceUrl: "https://example.com/registry",
          catalogConfidence: "high",
          scope: "Registry fixture scope.",
          contributes: "Entries and relation citations.",
          excludes: "Unreviewed duplicates.",
        },
        {
          source: "inventory.dc_laws",
          sourceType: "inventory.backlog",
          family: "legal_provenance",
          publisher: "D.C. Law Library",
          accessMethod: "Official law corpus website",
          sourceUrl: "https://code.dccouncil.gov/dclaws",
          catalogConfidence: "high",
          scope: "D.C. laws corpus fixture.",
          contributes: "Legal-source inventory row.",
          excludes: "Full law text ingestion.",
        },
        {
          source: "blocked.source",
          sourceType: "inventory.backlog",
          family: "blocked",
          publisher: "Fixture Publisher",
          accessMethod: "Fixture backlog",
          sourceUrl: "https://example.com/blocked",
          catalogConfidence: "medium",
          scope: "Known source not present in this workspace.",
          contributes: "No current state entries.",
          excludes: "Live-only records.",
          notes: "Fixture for not_collected coverage rows.",
        },
      ],
      sourceCoverageStats: [
        { source: "gazette", snapshotCount: 1, recordCount: 1, citationCount: 4 },
        { source: "registry", snapshotCount: 1, recordCount: 1, citationCount: 7 },
      ],
      reviewItems: [
        makeReviewItem({
          id: "deferred-source",
          category: "source_stale_or_failed",
          classification: "source_ingestion_bug",
          status: "open",
          findingCode: "dc.interpreter.opendc_stale_or_failed_duplicate",
        }),
        makeReviewItem({
          id: "applied-source-shadow",
          category: "source_shadow",
          classification: "curation_conflict",
          status: "applied",
        }),
      ],
    });

    assertEquals(result.entryCount, 10);
    assertEquals(result.relationCount, 9);
    assertEquals(result.citationCount, 12);
    assertEquals(result.sourceCount, 2);
    assertEquals(result.sourceCoverageCount, 4);
    assertEquals(result.boardAffiliationCount, 1);
    assertEquals(result.commissionAffiliationCount, 1);
    assertEquals(result.authorityAffiliationCount, 1);
    assertEquals(result.ancSmdStructureCount, 1);
    assertEquals(result.councilCommitteeMembershipCount, 1);
    assertEquals(result.dcAgencyCount, 1);
    assertEquals(result.dcOfficeCount, 0);
    assertEquals(result.dcCouncilmemberCount, 1);
    assertEquals(result.dcCouncilCommitteeCount, 1);
    assertEquals(result.dcPublicBodyCount, 3);
    assertEquals(result.dcPublicBodyAffiliationCount, 3);
    assertEquals(result.dcAncCount, 1);
    assertEquals(result.dcSmdCount, 1);
    assertEquals(result.dcWardCount, 0);
    assertEquals(result.dcCourtCount, 0);
    assertEquals(result.dcLegalAuthorityCount, 1);
    assertEquals(result.dcSourceCount, 4);
    assertEquals(result.govGraphNodeCount, 10);
    assertEquals(result.govGraphEdgeCount, 8);
    assertEquals(result.govGraphExcludedNodeCount, 0);
    assertEquals(result.govGraphExcludedEdgeCount, 1);
    assertEquals(result.govGraphBlockedReviewItemCount, 0);

    const expectedFiles = [
      "_local/ledger_entries.csv",
      "_local/ledger_relations.csv",
      "_local/ledger_citations.csv",
      "_local/source_counts.csv",
      "_local/source_coverage.csv",
      "_local/dc_board_affiliations.csv",
      "_local/dc_commission_affiliations.csv",
      "_local/dc_authority_affiliations.csv",
      "_local/dc_anc_smd_structure.csv",
      "dc_council_committee_memberships.csv",
      "dc_agencies.csv",
      "dc_offices.csv",
      "dc_councilmembers.csv",
      "dc_council_committees.csv",
      "dc_public_bodies.csv",
      "dc_public_body_affiliations.csv",
      "dc_ancs.csv",
      "dc_smds.csv",
      "_local/dc_smd_commissioners.csv",
      "dc_wards.csv",
      "dc_courts.csv",
      "dc_legal_authorities.csv",
      "dc_relationships.csv",
      "dc_sources.csv",
      "govgraph_nodes.json",
      "govgraph_edges.json",
      "govgraph_summary.json",
      "manifest.json",
      "ledger.sqlite",
      "README.md",
    ];

    for (const expected of expectedFiles) {
      assertEquals(await exists(join(releaseRoot, expected)), true);
    }
    assertEquals(await exists(join(releaseRoot, "entries.csv")), false);
    assertEquals(await exists(join(releaseRoot, "dc_council_committee_membership.csv")), false);
    const releaseParentEntries = [];
    for await (const entry of Deno.readDir(join(releaseRoot, ".."))) {
      releaseParentEntries.push(entry.name);
    }
    assertEquals(
      releaseParentEntries.some((name) => name.includes(".export-") && name.endsWith(".tmp")),
      false,
    );

    const manifest = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "manifest.json")),
    ) as Record<string, unknown>;
    assertEquals(manifest.jurisdiction, "dc");
    assertEquals(manifest.schemaVersion, 1);
    const provenance = manifest.provenance as Record<string, unknown>;
    assertEquals(typeof provenance.gitHeadCommit, "string");
    assertEquals(/^[0-9a-f]{40}$/.test(provenance.gitHeadCommit as string), true);
    assertEquals(provenance.gitSource, "git_metadata");
    assertEquals(
      ["clean", "dirty", "unknown"].includes(provenance.workingTreeStatus as string),
      true,
    );
    assertEquals(
      provenance.workingTreeStatus === "unknown"
        ? provenance.workingTreeChangedPathCount === null
        : typeof provenance.workingTreeChangedPathCount === "number",
      true,
    );
    assertEquals((manifest.counts as Record<string, unknown>).entries, 10);
    assertEquals(
      (manifest.counts as Record<string, unknown>).entryKinds,
      {
        "dc.agency": 1,
        "dc.anc": 1,
        "dc.anc_commissioner_seat": 1,
        "dc.authority": 1,
        "dc.board": 1,
        "dc.commission": 1,
        "dc.committee": 1,
        "dc.councilmember": 1,
        "dc.legal_authority": 1,
        "dc.smd": 1,
      },
    );
    assertEquals((manifest.counts as Record<string, unknown>).relations, 9);
    assertEquals(
      (manifest.counts as Record<string, unknown>).relationKinds,
      {
        "dc.relation:affiliated_with": 1,
        "dc.relation:authorized_by": 1,
        "dc.relation:chairs": 1,
        "dc.relation:contains": 1,
        "dc.relation:governs": 2,
        "dc.relation:member_of": 1,
        "dc.relation:oversees": 1,
        "dc.relation:represents": 1,
      },
    );
    assertEquals((manifest.counts as Record<string, unknown>).citations, 12);
    assertEquals((manifest.counts as Record<string, unknown>).sources, 2);
    assertEquals((manifest.counts as Record<string, unknown>).sourceCoverage, 4);
    assertEquals(
      (manifest.counts as Record<string, unknown>).sourceCoverageStatuses,
      {
        collected: 2,
        not_collected: 2,
      },
    );
    assertEquals(manifest.sourceCoverageStatusCounts, {
      collected: 2,
      not_collected: 2,
    });
    assertEquals(
      (manifest.counts as Record<string, unknown>).sourceCoverageReleaseStatuses,
      {
        exported: 2,
        inventory_only: 2,
      },
    );
    assertEquals(manifest.sourceCoverageReleaseStatusCounts, {
      exported: 2,
      inventory_only: 2,
    });
    assertEquals((manifest.counts as Record<string, unknown>).sourceCoverageFamilies, 4);
    assertEquals(manifest.sourceCoverageFamilyRollup, [
      {
        family: "blocked",
        rows: 1,
        collectionStatuses: { not_collected: 1 },
        releaseStatuses: { inventory_only: 1 },
      },
      {
        family: "legal",
        rows: 1,
        collectionStatuses: { collected: 1 },
        releaseStatuses: { exported: 1 },
      },
      {
        family: "legal_provenance",
        rows: 1,
        collectionStatuses: { not_collected: 1 },
        releaseStatuses: { inventory_only: 1 },
      },
      {
        family: "registry",
        rows: 1,
        collectionStatuses: { collected: 1 },
        releaseStatuses: { exported: 1 },
      },
    ]);
    assertEquals((manifest.counts as Record<string, unknown>).reviewItems, 2);
    assertEquals(
      (manifest.counts as Record<string, unknown>).reviewQueues,
      {
        blocking: 0,
        actionable: 0,
        drafted: 0,
        applied: 1,
        deferred: 1,
      },
    );
    assertEquals(manifest.reviewQueueCounts, {
      blocking: 0,
      actionable: 0,
      drafted: 0,
      applied: 1,
      deferred: 1,
    });
    assertEquals(
      (manifest.counts as Record<string, unknown>).reviewCategories,
      {
        source_shadow: 1,
        source_stale_or_failed: 1,
      },
    );
    assertEquals(manifest.reviewCategoryCounts, {
      source_shadow: 1,
      source_stale_or_failed: 1,
    });
    assertEquals(
      (manifest.counts as Record<string, unknown>).reviewDeferredGroups,
      [
        {
          category: "source_stale_or_failed",
          label: "dc.interpreter.opendc_stale_or_failed_duplicate",
          count: 1,
          description:
            "A stale or failed Open DC duplicate fragment was suppressed as a source ingestion bug, not treated as a civic entity or release blocker.",
        },
      ],
    );
    assertEquals(manifest.reviewDeferredGroups, [
      {
        category: "source_stale_or_failed",
        label: "dc.interpreter.opendc_stale_or_failed_duplicate",
        count: 1,
        description:
          "A stale or failed Open DC duplicate fragment was suppressed as a source ingestion bug, not treated as a civic entity or release blocker.",
      },
    ]);
    assertEquals((manifest.counts as Record<string, unknown>).ancSmdStructure, 1);
    assertEquals((manifest.counts as Record<string, unknown>).councilCommitteeMembership, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcAgencies, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcOffices, 0);
    assertEquals((manifest.counts as Record<string, unknown>).dcCouncilmembers, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcCouncilCommittees, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcPublicBodies, 3);
    assertEquals((manifest.counts as Record<string, unknown>).dcPublicBodyAffiliations, 3);
    assertEquals((manifest.counts as Record<string, unknown>).dcAncs, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcSmds, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcWards, 0);
    assertEquals((manifest.counts as Record<string, unknown>).dcCourts, 0);
    assertEquals((manifest.counts as Record<string, unknown>).dcLegalAuthorities, 1);
    assertEquals((manifest.counts as Record<string, unknown>).dcSources, 4);
    assertEquals((manifest.counts as Record<string, unknown>).collectedSourceCount, 2);
    assertEquals((manifest.counts as Record<string, unknown>).sourceInventoryCount, 4);
    assertEquals((manifest.counts as Record<string, unknown>).publicSourceRows, 4);
    assertEquals((manifest.counts as Record<string, unknown>).govGraphNodes, 10);
    assertEquals((manifest.counts as Record<string, unknown>).govGraphEdges, 8);
    assertEquals((manifest.govGraph as Record<string, unknown>).nodeKindCounts, {
      "dc.agency": 1,
      "dc.anc": 1,
      "dc.anc_commissioner_seat": 1,
      "dc.authority": 1,
      "dc.board": 1,
      "dc.commission": 1,
      "dc.committee": 1,
      "dc.councilmember": 1,
      "dc.legal_authority": 1,
      "dc.smd": 1,
    });
    assertEquals((manifest.govGraph as Record<string, unknown>).nodeCategoryCounts, {
      executive: 1,
      legislative: 1,
      legal_authority: 1,
      neighborhood: 3,
      public_body: 3,
      representation: 1,
    });
    assertEquals(
      (manifest.outputs as Record<string, unknown>).sourceCoverageCsv,
      "_local/source_coverage.csv",
    );
    assertEquals(
      (manifest.outputs as Record<string, unknown>).govGraphNodesJson,
      "govgraph_nodes.json",
    );
    assertEquals(
      (manifest.outputs as Record<string, unknown>).ancSmdStructureCsv,
      "_local/dc_anc_smd_structure.csv",
    );
    assertEquals(
      (manifest.outputs as Record<string, unknown>).councilCommitteeMembershipCsv,
      "dc_council_committee_memberships.csv",
    );
    assertEquals((manifest.outputs as Record<string, unknown>).dcAgenciesCsv, "dc_agencies.csv");
    assertEquals(
      (manifest.outputs as Record<string, unknown>).dcPublicBodiesCsv,
      "dc_public_bodies.csv",
    );
    assertEquals((manifest.outputs as Record<string, unknown>).dcSourcesCsv, "dc_sources.csv");

    const manifestOutputs = manifest.outputs as Record<string, string>;
    assertEquals(manifestOutputs.readme, "README.md");
    assertEquals(manifestOutputs.sha256Sums, "SHA256SUMS");
    assertEquals("manifestJson" in manifestOutputs, false);
    for (const outputPath of Object.values(manifestOutputs)) {
      assertEquals(await exists(join(releaseRoot, outputPath)), true);
    }
    const releaseAssets = manifest.releaseAssets as {
      paths: string[];
      outputNames: string[];
      items: Array<Record<string, unknown>>;
      categories: Record<string, number>;
      note: string;
      count: number;
    };
    assertEquals(releaseAssets.paths, [
      "dc_agencies.csv",
      "dc_offices.csv",
      "dc_councilmembers.csv",
      "dc_council_committees.csv",
      "dc_council_committee_memberships.csv",
      "dc_public_bodies.csv",
      "dc_public_body_affiliations.csv",
      "dc_ancs.csv",
      "dc_smds.csv",
      "dc_wards.csv",
      "dc_courts.csv",
      "dc_legal_authorities.csv",
      "dc_relationships.csv",
      "dc_sources.csv",
      "govgraph_nodes.json",
      "govgraph_edges.json",
      "govgraph_summary.json",
      "ledger.sqlite",
      "README.md",
      "SHA256SUMS",
      "manifest.json",
    ]);
    assertEquals(releaseAssets.outputNames, [
      "dcAgenciesCsv",
      "dcOfficesCsv",
      "dcCouncilmembersCsv",
      "dcCouncilCommitteesCsv",
      "councilCommitteeMembershipCsv",
      "dcPublicBodiesCsv",
      "dcPublicBodyAffiliationsCsv",
      "dcAncsCsv",
      "dcSmdsCsv",
      "dcWardsCsv",
      "dcCourtsCsv",
      "dcLegalAuthoritiesCsv",
      "dcRelationshipsCsv",
      "dcSourcesCsv",
      "govGraphNodesJson",
      "govGraphEdgesJson",
      "govGraphSummaryJson",
      "ledgerSqlite",
      "readme",
      "sha256Sums",
      "manifestJson",
    ]);
    assertEquals(releaseAssets.categories, {
      database: 1,
      documentation: 2,
      machine_json: 4,
      public_csv: 14,
    });
    assertEquals(
      releaseAssets.note,
      "Upload these files as separate GitHub release assets.",
    );
    assertEquals(releaseAssets.count, 21);
    assertEquals(releaseAssets.items.length, 21);
    const releaseAssetByName = new Map(releaseAssets.items.map((item) => [item.outputName, item]));
    assertEquals(releaseAssetByName.get("dcCouncilmembersCsv")?.path, "dc_councilmembers.csv");
    assertEquals(releaseAssetByName.get("dcCouncilmembersCsv")?.category, "public_csv");
    assertEquals(
      releaseAssetByName.get("dcCouncilmembersCsv")?.description,
      "Current Council roster, seats, wards, and profiles.",
    );
    assertEquals(releaseAssetByName.get("dcCouncilmembersCsv")?.rowCount, 1);
    assertEquals(releaseAssetByName.get("dcCouncilmembersCsv")?.columnCount, 10);
    assertEquals(releaseAssetByName.get("govGraphSummaryJson")?.category, "machine_json");
    assertEquals(
      releaseAssetByName.get("ledgerSqlite")?.description,
      "SQLite database with the public tables, audit tables, and a table catalog.",
    );
    assertEquals(releaseAssetByName.get("manifestJson"), {
      outputName: "manifestJson",
      path: "manifest.json",
      category: "machine_json",
      releaseAsset: true,
      description: "Release manifest with file sizes, hashes, row counts, and asset categories.",
    });
    assertEquals(manifest.manifestFile, {
      path: "manifest.json",
      releaseAsset: true,
      checksumListedInSha256Sums: false,
      note:
        "manifest.json is uploaded as a release asset but is not listed in SHA256SUMS because it records file hashes and is written after the other file metadata is calculated.",
    });
    const localOnlyOutputs = manifest.localOnlyOutputs as {
      paths: string[];
      outputNames: string[];
      items: Array<Record<string, unknown>>;
      categories: Record<string, number>;
      note: string;
      count: number;
    };
    assertEquals(localOnlyOutputs.paths, [
      "_local/ledger_entries.csv",
      "_local/ledger_relations.csv",
      "_local/ledger_citations.csv",
      "_local/source_counts.csv",
      "_local/source_coverage.csv",
      "_local/dc_smd_commissioners.csv",
      "_local/dc_board_affiliations.csv",
      "_local/dc_commission_affiliations.csv",
      "_local/dc_authority_affiliations.csv",
      "_local/dc_anc_smd_structure.csv",
    ]);
    assertEquals(localOnlyOutputs.outputNames, [
      "entriesCsv",
      "relationsCsv",
      "citationsCsv",
      "sourcesCsv",
      "sourceCoverageCsv",
      "dcSmdCommissionersCsv",
      "boardAffiliationsCsv",
      "commissionAffiliationsCsv",
      "authorityAffiliationsCsv",
      "ancSmdStructureCsv",
    ]);
    assertEquals(localOnlyOutputs.categories, {
      compatibility_csv: 5,
      traceability_csv: 5,
    });
    assertEquals(
      localOnlyOutputs.note,
      "Kept under _local and bundled into ledger.sqlite for audit; do not upload as separate GitHub assets.",
    );
    assertEquals(localOnlyOutputs.count, 10);
    assertEquals(localOnlyOutputs.items.length, 10);
    const localOnlyByName = new Map(localOnlyOutputs.items.map((item) => [item.outputName, item]));
    assertEquals(localOnlyByName.get("entriesCsv")?.path, "_local/ledger_entries.csv");
    assertEquals(localOnlyByName.get("entriesCsv")?.category, "traceability_csv");
    assertEquals(
      localOnlyByName.get("entriesCsv")?.description,
      "Audit table with every ledger entry, attributes JSON, and citations.",
    );
    assertEquals(localOnlyByName.get("entriesCsv")?.rowCount, 10);
    assertEquals(localOnlyByName.get("boardAffiliationsCsv")?.category, "compatibility_csv");
    assertEquals(
      localOnlyByName.get("boardAffiliationsCsv")?.description,
      "Compatibility board-to-agency link table; prefer dc_public_body_affiliations.csv.",
    );
    assertEquals(localOnlyByName.get("boardAffiliationsCsv")?.columnCount, 6);
    assertEquals(manifest.sqliteTables, {
      description:
        "ledger.sqlite bundles public tables, audit tables, helper tables, and release_table_catalog.",
      metadataTables: ["release_table_catalog"],
      publicTables: [
        "dc_agencies",
        "dc_offices",
        "dc_councilmembers",
        "dc_council_committees",
        "dc_council_committee_memberships",
        "dc_public_bodies",
        "dc_public_body_affiliations",
        "dc_ancs",
        "dc_smds",
        "dc_wards",
        "dc_courts",
        "dc_legal_authorities",
        "dc_relationships",
        "dc_sources",
      ],
      traceabilityTables: [
        "ledger_entries",
        "ledger_relations",
        "ledger_citations",
        "source_counts",
        "source_coverage",
      ],
      compatibilityTables: [
        "dc_smd_commissioners",
        "dc_board_affiliations",
        "dc_commission_affiliations",
        "dc_authority_affiliations",
        "dc_anc_smd_structure",
      ],
      rawLedgerTables: ["entries", "relations", "citations", "sources"],
    });
    assertEquals(manifest.startHere, {
      primaryReadme: "README.md",
      recommendedEntryPoints: [
        {
          label: "Download a CSV",
          path: "README.md",
          note: "Short release index with row counts and file descriptions.",
        },
        {
          label: "Check file metadata",
          path: "manifest.json",
          note: "Assets, local audit outputs, hashes, row counts, and columns.",
        },
        {
          label: "Query SQLite",
          path: "ledger.sqlite",
          note: "Open release_table_catalog first for table groups, row counts, and columns.",
        },
        {
          label: "Use graph JSON",
          path: "govgraph_summary.json",
          note:
            "Field descriptions and join rules for govgraph_nodes.json and govgraph_edges.json.",
        },
      ],
      releaseAssetCount: 21,
      publicCsvCount: 14,
      localAuditOutputCount: 10,
      sqliteCatalogTable: "release_table_catalog",
      govGraphSchemaFile: "govgraph_summary.json",
    });
    assertEquals(
      (manifest.counts as Record<string, unknown>).outputFiles,
      Object.keys(manifestOutputs).length,
    );
    const outputCatalog = manifest.outputCatalog as Array<Record<string, unknown>>;
    assertEquals(outputCatalog.length, Object.keys(manifestOutputs).length);
    assertEquals(outputCatalog.slice(0, 5).map((item) => item.path), [
      "dc_agencies.csv",
      "dc_offices.csv",
      "dc_councilmembers.csv",
      "dc_council_committees.csv",
      "dc_council_committee_memberships.csv",
    ]);
    const outputCatalogByName = new Map(outputCatalog.map((item) => [item.outputName, item]));
    assertEquals(outputCatalogByName.get("dcCouncilmembersCsv")?.path, "dc_councilmembers.csv");
    assertEquals(outputCatalogByName.get("dcCouncilmembersCsv")?.category, "public_csv");
    assertEquals(outputCatalogByName.get("dcCouncilmembersCsv")?.releaseAsset, true);
    assertEquals(
      outputCatalogByName.get("dcCouncilmembersCsv")?.description,
      "Current Council roster, seats, wards, and profiles.",
    );
    assertEquals(outputCatalogByName.get("councilCommitteeMembershipCsv")?.category, "public_csv");
    assertEquals(outputCatalogByName.get("entriesCsv")?.category, "traceability_csv");
    assertEquals(outputCatalogByName.get("entriesCsv")?.releaseAsset, false);
    assertEquals(
      outputCatalogByName.get("entriesCsv")?.description,
      "Audit table with every ledger entry, attributes JSON, and citations.",
    );
    assertEquals(outputCatalogByName.get("boardAffiliationsCsv")?.releaseAsset, false);
    assertEquals(outputCatalogByName.get("boardAffiliationsCsv")?.category, "compatibility_csv");
    assertEquals(
      outputCatalogByName.get("boardAffiliationsCsv")?.description,
      "Compatibility board-to-agency link table; prefer dc_public_body_affiliations.csv.",
    );
    assertEquals(outputCatalogByName.get("commissionAffiliationsCsv")?.releaseAsset, false);
    assertEquals(
      outputCatalogByName.get("commissionAffiliationsCsv")?.category,
      "compatibility_csv",
    );
    assertEquals(outputCatalogByName.get("authorityAffiliationsCsv")?.releaseAsset, false);
    assertEquals(
      outputCatalogByName.get("authorityAffiliationsCsv")?.category,
      "compatibility_csv",
    );
    assertEquals(outputCatalogByName.get("ancSmdStructureCsv")?.releaseAsset, false);
    assertEquals(outputCatalogByName.get("ancSmdStructureCsv")?.category, "compatibility_csv");
    assertEquals(outputCatalogByName.get("dcSmdCommissionersCsv")?.releaseAsset, false);
    assertEquals(outputCatalogByName.get("dcSmdCommissionersCsv")?.category, "compatibility_csv");
    assertEquals(outputCatalogByName.get("govGraphNodesJson")?.category, "machine_json");
    assertEquals(outputCatalogByName.get("ledgerSqlite")?.category, "database");
    assertEquals(outputCatalogByName.get("readme")?.category, "documentation");
    assertEquals(outputCatalogByName.get("sha256Sums")?.category, "documentation");
    assertEquals(outputCatalogByName.get("sha256Sums")?.releaseAsset, true);
    const outputFileMetadata = manifest.outputFileMetadata as Record<
      string,
      {
        path: string;
        byteSize: number;
        sha256: string;
        rowCount?: number;
        columnCount?: number;
        columns?: string[];
      }
    >;
    assertEquals(
      Object.keys(outputFileMetadata).sort(),
      Object.keys(manifestOutputs).sort(),
    );
    assertEquals("manifestJson" in outputFileMetadata, false);
    for (const [outputName, outputPath] of Object.entries(manifestOutputs)) {
      const metadata = outputFileMetadata[outputName];
      const catalogItem = outputCatalogByName.get(outputName);
      const bytes = await Deno.readFile(join(releaseRoot, outputPath));
      assertEquals(metadata.path, outputPath);
      assertEquals(metadata.byteSize, bytes.byteLength);
      assertEquals(metadata.sha256, await sha256Hex(bytes));
      assertEquals(/^[0-9a-f]{64}$/.test(metadata.sha256), true);
      assertEquals(catalogItem?.byteSize, metadata.byteSize);
      assertEquals(catalogItem?.sha256, metadata.sha256);
      assertEquals(catalogItem?.rowCount, metadata.rowCount);
      assertEquals(catalogItem?.columnCount, metadata.columnCount);
      assertEquals(catalogItem?.columns, metadata.columns);
    }
    const sha256Sums = await Deno.readTextFile(join(releaseRoot, "SHA256SUMS"));
    assertEquals(
      sha256Sums.includes(`${outputFileMetadata.dcAgenciesCsv.sha256}  dc_agencies.csv`),
      true,
    );
    assertEquals(sha256Sums.includes(`${outputFileMetadata.readme.sha256}  README.md`), true);
    assertEquals(sha256Sums.includes("manifest.json"), false);
    assertEquals(sha256Sums.includes("SHA256SUMS"), false);
    const sha256SumsPath = join(releaseRoot, "SHA256SUMS");
    const originalSha256Sums = sha256Sums;
    const sha256SumsCatalogItem = outputCatalogByName.get("sha256Sums");
    const originalSha256SumsMetadata = { ...outputFileMetadata.sha256Sums };
    const originalSha256SumsCatalogMetadata = sha256SumsCatalogItem
      ? { ...sha256SumsCatalogItem }
      : null;
    const tamperedSha256Sums = `${outputFileMetadata.dcAgenciesCsv.sha256}  dc_agencies.csv\n`;
    const tamperedSha256SumsBytes = new TextEncoder().encode(tamperedSha256Sums);
    await Deno.writeTextFile(sha256SumsPath, tamperedSha256Sums);
    outputFileMetadata.sha256Sums.byteSize = tamperedSha256SumsBytes.byteLength;
    outputFileMetadata.sha256Sums.sha256 = await sha256Hex(tamperedSha256SumsBytes);
    if (sha256SumsCatalogItem) {
      sha256SumsCatalogItem.byteSize = outputFileMetadata.sha256Sums.byteSize;
      sha256SumsCatalogItem.sha256 = outputFileMetadata.sha256Sums.sha256;
    }
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const tamperedSha256SumsVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(tamperedSha256SumsVerification.valid, false);
    assertEquals(
      tamperedSha256SumsVerification.errors.some((error) =>
        error.includes(
          "SHA256SUMS must list exactly release upload assets except manifest.json and SHA256SUMS",
        )
      ),
      true,
    );
    await Deno.writeTextFile(sha256SumsPath, originalSha256Sums);
    outputFileMetadata.sha256Sums = originalSha256SumsMetadata;
    if (sha256SumsCatalogItem && originalSha256SumsCatalogMetadata) {
      Object.assign(sha256SumsCatalogItem, originalSha256SumsCatalogMetadata);
    }
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredSha256SumsVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredSha256SumsVerification.valid, true);
    assertEquals(outputFileMetadata.dcCouncilmembersCsv.rowCount, 1);
    assertEquals(outputFileMetadata.dcCouncilmembersCsv.columnCount, 10);
    assertEquals(outputFileMetadata.dcCouncilmembersCsv.columns, [
      "sort_order",
      "councilmember_id",
      "name",
      "seat_type",
      "office_title",
      "ward",
      "is_at_large",
      "profile_url",
      "source_url",
      "source_id",
    ]);
    assertEquals(outputFileMetadata.govGraphNodesJson.rowCount, undefined);
    assertEquals(outputFileMetadata.govGraphNodesJson.columns, undefined);
    const verification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(verification.valid, true);
    assertEquals(verification.checkedFileCount, Object.keys(manifestOutputs).length);
    assertEquals(verification.errors, []);

    const originalJurisdiction = manifest.jurisdiction;
    manifest.jurisdiction = "not-dc";
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const invalidJurisdictionVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(invalidJurisdictionVerification.valid, false);
    assertEquals(
      invalidJurisdictionVerification.errors.some((error) =>
        error.includes("manifest.jurisdiction must be dc, found not-dc")
      ),
      true,
    );
    manifest.jurisdiction = originalJurisdiction;

    const councilmemberCatalogItem = outputCatalogByName.get("dcCouncilmembersCsv");
    const originalCouncilmemberCatalogPath = councilmemberCatalogItem?.path;
    if (councilmemberCatalogItem) {
      councilmemberCatalogItem.path = "wrong.csv";
    }
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleOutputCatalogVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleOutputCatalogVerification.valid, false);
    assertEquals(
      staleOutputCatalogVerification.errors.some((error) =>
        error.includes(
          "manifest outputCatalog dcCouncilmembersCsv path mismatch: expected dc_councilmembers.csv, found wrong.csv",
        )
      ),
      true,
    );
    if (councilmemberCatalogItem && typeof originalCouncilmemberCatalogPath === "string") {
      councilmemberCatalogItem.path = originalCouncilmemberCatalogPath;
    }

    const originalExportedAt = manifest.exportedAt;
    manifest.exportedAt = "not-a-timestamp";
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const invalidExportedAtVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(invalidExportedAtVerification.valid, false);
    assertEquals(
      invalidExportedAtVerification.errors.some((error) =>
        error.includes("manifest.exportedAt must be a UTC ISO timestamp string")
      ),
      true,
    );
    manifest.exportedAt = originalExportedAt;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredIdentityVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredIdentityVerification.valid, true);

    const originalProvenance = manifest.provenance;
    manifest.provenance = {
      ...(originalProvenance as Record<string, unknown>),
      gitHeadCommit: "not-a-commit",
    };
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const invalidProvenanceVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(invalidProvenanceVerification.valid, false);
    assertEquals(
      invalidProvenanceVerification.errors.some((error) =>
        error.includes(
          "manifest.provenance.gitHeadCommit must be null or a 40-character git HEAD commit hash",
        )
      ),
      true,
    );
    manifest.provenance = originalProvenance;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredProvenanceVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredProvenanceVerification.valid, true);

    manifest.provenance = {
      ...(originalProvenance as Record<string, unknown>),
      workingTreeStatus: "clean",
      workingTreeChangedPathCount: 1,
    };
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleWorkingTreeProvenanceVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleWorkingTreeProvenanceVerification.valid, false);
    assertEquals(
      staleWorkingTreeProvenanceVerification.errors.some((error) =>
        error.includes(
          "manifest.provenance.workingTreeChangedPathCount must be 0 when workingTreeStatus is clean",
        )
      ),
      true,
    );
    manifest.provenance = originalProvenance;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredWorkingTreeProvenanceVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredWorkingTreeProvenanceVerification.valid, true);

    const manifestCounts = manifest.counts as Record<string, unknown>;
    const originalEntryCount = manifestCounts.entries;
    manifestCounts.entries = Number(originalEntryCount) + 1;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleEntryCountVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleEntryCountVerification.valid, false);
    assertEquals(
      staleEntryCountVerification.errors.some((error) =>
        error.includes(
          `counts.entries ${
            Number(originalEntryCount) + 1
          } does not match _local/ledger_entries.csv data rows ${Number(originalEntryCount)}`,
        )
      ),
      true,
    );
    manifestCounts.entries = originalEntryCount;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredEntryCountVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredEntryCountVerification.valid, true);

    const originalOutputFileCount = manifestCounts.outputFiles;
    manifestCounts.outputFiles = String(originalOutputFileCount);
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleOutputFileCountVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleOutputFileCountVerification.valid, false);
    assertEquals(
      staleOutputFileCountVerification.errors.some((error) =>
        error.includes("counts.outputFiles must be a non-negative integer")
      ),
      true,
    );
    manifestCounts.outputFiles = originalOutputFileCount;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredOutputFileCountVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredOutputFileCountVerification.valid, true);

    const originalEntryKinds = manifestCounts.entryKinds;
    const originalRelationKinds = manifestCounts.relationKinds;
    manifestCounts.entryKinds = {};
    manifestCounts.relationKinds = {};
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleKindRollupVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleKindRollupVerification.valid, false);
    assertEquals(
      staleKindRollupVerification.errors.some((error) =>
        error.includes(
          "_local/ledger_entries.csv kind counts must match manifest.counts.entryKinds",
        )
      ),
      true,
    );
    assertEquals(
      staleKindRollupVerification.errors.some((error) =>
        error.includes(
          "_local/ledger_relations.csv relation_kind counts must match manifest.counts.relationKinds",
        )
      ),
      true,
    );
    manifestCounts.entryKinds = originalEntryKinds;
    manifestCounts.relationKinds = originalRelationKinds;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredKindRollupVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredKindRollupVerification.valid, true);

    const originalReviewQueueCounts = manifest.reviewQueueCounts;
    const originalReviewCategoryCounts = manifest.reviewCategoryCounts;
    const originalReviewDeferredGroups = manifest.reviewDeferredGroups;
    const originalCountReviewQueues = manifestCounts.reviewQueues;
    const originalCountReviewCategories = manifestCounts.reviewCategories;
    const originalCountReviewDeferredGroups = manifestCounts.reviewDeferredGroups;
    manifest.reviewQueueCounts = {
      ...(originalReviewQueueCounts as Record<string, unknown>),
      deferred: 2,
    };
    manifest.reviewCategoryCounts = {};
    manifest.reviewDeferredGroups = [];
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleReviewPostureVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleReviewPostureVerification.valid, false);
    assertEquals(
      staleReviewPostureVerification.errors.some((error) =>
        error.includes("manifest.reviewQueueCounts must match manifest.counts.reviewQueues")
      ),
      true,
    );
    assertEquals(
      staleReviewPostureVerification.errors.some((error) =>
        error.includes("manifest.reviewCategoryCounts must match manifest.counts.reviewCategories")
      ),
      true,
    );
    assertEquals(
      staleReviewPostureVerification.errors.some((error) =>
        error.includes(
          "manifest.reviewDeferredGroups must match manifest.counts.reviewDeferredGroups",
        )
      ),
      true,
    );
    assertEquals(
      staleReviewPostureVerification.errors.some((error) =>
        error.includes(
          "manifest.reviewQueueCounts.deferred 2 does not match manifest.reviewDeferredGroups count total 0",
        )
      ),
      true,
    );
    manifest.reviewQueueCounts = originalReviewQueueCounts;
    manifest.reviewCategoryCounts = originalReviewCategoryCounts;
    manifest.reviewDeferredGroups = originalReviewDeferredGroups;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredReviewPostureVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredReviewPostureVerification.valid, true);

    const originalReviewQueueRecord = originalReviewQueueCounts as Record<string, number>;
    const donorReviewQueue = originalReviewQueueRecord.applied > 0 ? "applied" : "deferred";
    const blockingReviewQueueCounts = {
      ...originalReviewQueueRecord,
      blocking: originalReviewQueueRecord.blocking + 1,
      [donorReviewQueue]: originalReviewQueueRecord[donorReviewQueue] - 1,
    };
    manifest.reviewQueueCounts = blockingReviewQueueCounts;
    manifestCounts.reviewQueues = blockingReviewQueueCounts;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const blockingReviewQueueVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(blockingReviewQueueVerification.valid, false);
    assertEquals(
      blockingReviewQueueVerification.errors.some((error) =>
        error.includes(
          "manifest.reviewQueueCounts.blocking must be 0 for release verification, found 1",
        )
      ),
      true,
    );
    manifest.reviewQueueCounts = originalReviewQueueCounts;
    manifestCounts.reviewQueues = originalCountReviewQueues;

    const unknownReviewQueueCounts = {
      ...(originalReviewQueueCounts as Record<string, unknown>),
      parked: 0,
    };
    manifest.reviewQueueCounts = unknownReviewQueueCounts;
    manifestCounts.reviewQueues = unknownReviewQueueCounts;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const unknownReviewQueueVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(unknownReviewQueueVerification.valid, false);
    assertEquals(
      unknownReviewQueueVerification.errors.some((error) =>
        error.includes(
          "manifest.reviewQueueCounts keys must be exactly blocking, actionable, drafted, applied, deferred",
        )
      ),
      true,
    );
    manifest.reviewQueueCounts = originalReviewQueueCounts;
    manifestCounts.reviewQueues = originalCountReviewQueues;

    const unknownReviewCategoryCounts = {
      ...(originalReviewCategoryCounts as Record<string, unknown>),
      unknown_review_category: 0,
    };
    manifest.reviewCategoryCounts = unknownReviewCategoryCounts;
    manifestCounts.reviewCategories = unknownReviewCategoryCounts;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const unknownReviewCategoryVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(unknownReviewCategoryVerification.valid, false);
    assertEquals(
      unknownReviewCategoryVerification.errors.some((error) =>
        error.includes(
          "manifest.reviewCategoryCounts.unknown_review_category is not a known review category",
        )
      ),
      true,
    );
    manifest.reviewCategoryCounts = originalReviewCategoryCounts;
    manifestCounts.reviewCategories = originalCountReviewCategories;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredReviewCategoryVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredReviewCategoryVerification.valid, true);

    const missingDeferredGroupDescription = (originalReviewDeferredGroups as Array<
      Record<string, unknown>
    >).map((group) => ({ ...group, description: null }));
    manifest.reviewDeferredGroups = missingDeferredGroupDescription;
    manifestCounts.reviewDeferredGroups = missingDeferredGroupDescription;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const missingDeferredGroupDescriptionVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(missingDeferredGroupDescriptionVerification.valid, false);
    assertEquals(
      missingDeferredGroupDescriptionVerification.errors.some((error) =>
        error.includes("manifest.reviewDeferredGroups[0].description must be a non-empty string")
      ),
      true,
    );
    manifest.reviewDeferredGroups = originalReviewDeferredGroups;
    manifestCounts.reviewDeferredGroups = originalCountReviewDeferredGroups;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredDeferredGroupDescriptionVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredDeferredGroupDescriptionVerification.valid, true);

    const unknownDeferredGroupCategory = (originalReviewDeferredGroups as Array<
      Record<string, unknown>
    >).map((group, index) =>
      index === 0 ? { ...group, category: "unknown_review_category" } : group
    );
    manifest.reviewDeferredGroups = unknownDeferredGroupCategory;
    manifestCounts.reviewDeferredGroups = unknownDeferredGroupCategory;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const unknownDeferredGroupCategoryVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(unknownDeferredGroupCategoryVerification.valid, false);
    assertEquals(
      unknownDeferredGroupCategoryVerification.errors.some((error) =>
        error.includes(
          "manifest.reviewDeferredGroups[0].category unknown_review_category is not a known review category",
        )
      ),
      true,
    );
    manifest.reviewDeferredGroups = originalReviewDeferredGroups;
    manifestCounts.reviewDeferredGroups = originalCountReviewDeferredGroups;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredDeferredGroupCategoryVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredDeferredGroupCategoryVerification.valid, true);

    const sourceCoverageOutputPath = manifestOutputs.sourceCoverageCsv;
    const sourceCoveragePath = join(releaseRoot, sourceCoverageOutputPath);
    const originalSourceCoverage = await Deno.readTextFile(sourceCoveragePath);
    const writeSourceCoverageWithManifestMetadata = async (contents: string) => {
      const bytes = new TextEncoder().encode(contents);
      await Deno.writeTextFile(sourceCoveragePath, contents);
      outputFileMetadata.sourceCoverageCsv.byteSize = bytes.byteLength;
      outputFileMetadata.sourceCoverageCsv.sha256 = await sha256Hex(bytes);
      await Deno.writeTextFile(
        join(releaseRoot, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
    };
    const missingSourceCoveragePublisher = originalSourceCoverage.replace(
      "Fixture Gazette,Fixture feed",
      ",Fixture feed",
    );
    assertEquals(missingSourceCoveragePublisher === originalSourceCoverage, false);
    await writeSourceCoverageWithManifestMetadata(missingSourceCoveragePublisher);
    const missingSourceCoveragePublisherVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(missingSourceCoveragePublisherVerification.valid, false);
    assertEquals(
      missingSourceCoveragePublisherVerification.errors.some((error) =>
        error.includes("source_coverage.csv row") &&
        error.includes("publisher must be non-empty")
      ),
      true,
    );
    assertEquals(
      missingSourceCoveragePublisherVerification.errors.some((error) =>
        error.includes("sha256 mismatch for sourceCoverageCsv")
      ),
      false,
    );

    await writeSourceCoverageWithManifestMetadata(originalSourceCoverage);
    const restoredSourceCoverageMetadataVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredSourceCoverageMetadataVerification.valid, true);

    const invalidSourceCoverageReaderStatus = originalSourceCoverage.replace(
      ",collected,wired,wired,exported,",
      ",collected,hand_waved,wired,exported,",
    );
    assertEquals(invalidSourceCoverageReaderStatus === originalSourceCoverage, false);
    await writeSourceCoverageWithManifestMetadata(invalidSourceCoverageReaderStatus);
    const invalidSourceCoverageReaderStatusVerification = await verifyReleaseArtifacts(
      releaseRoot,
    );
    assertEquals(invalidSourceCoverageReaderStatusVerification.valid, false);
    assertEquals(
      invalidSourceCoverageReaderStatusVerification.errors.some((error) =>
        error.includes(
          'source_coverage.csv row 3 reader_status "hand_waved" must be one of inventory_only, uncataloged, wired',
        )
      ),
      true,
    );

    await writeSourceCoverageWithManifestMetadata(originalSourceCoverage);
    const restoredSourceCoverageVocabularyVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredSourceCoverageVocabularyVerification.valid, true);

    const inconsistentSourceCoverageStatuses = originalSourceCoverage.replace(
      ",collected,wired,wired,exported,1,1,",
      ",collected_empty,wired,wired,collected_empty,1,1,",
    );
    assertEquals(inconsistentSourceCoverageStatuses === originalSourceCoverage, false);
    const originalSourceCoverageStatusCounts = manifest.sourceCoverageStatusCounts;
    const originalCountSourceCoverageStatuses = manifestCounts.sourceCoverageStatuses;
    const originalSourceCoverageReleaseStatusCounts = manifest.sourceCoverageReleaseStatusCounts;
    const originalCountSourceCoverageReleaseStatuses = manifestCounts.sourceCoverageReleaseStatuses;
    const originalSourceCoverageFamilyRollup = manifest.sourceCoverageFamilyRollup;
    const mirroredCollectionStatusCounts = {
      collected: 1,
      collected_empty: 1,
      not_collected: 2,
    };
    const mirroredReleaseStatusCounts = {
      collected_empty: 1,
      exported: 1,
      inventory_only: 2,
    };
    manifest.sourceCoverageStatusCounts = mirroredCollectionStatusCounts;
    manifestCounts.sourceCoverageStatuses = mirroredCollectionStatusCounts;
    manifest.sourceCoverageReleaseStatusCounts = mirroredReleaseStatusCounts;
    manifestCounts.sourceCoverageReleaseStatuses = mirroredReleaseStatusCounts;
    manifest.sourceCoverageFamilyRollup = (originalSourceCoverageFamilyRollup as Array<
      Record<string, unknown>
    >).map((rollup) =>
      rollup.family === "legal"
        ? {
          ...rollup,
          collectionStatuses: { collected: 1 },
          releaseStatuses: { collected_empty: 1 },
        }
        : rollup
    );
    await writeSourceCoverageWithManifestMetadata(inconsistentSourceCoverageStatuses);
    const inconsistentSourceCoverageStatusesVerification = await verifyReleaseArtifacts(
      releaseRoot,
    );
    assertEquals(inconsistentSourceCoverageStatusesVerification.valid, false);
    assertEquals(
      inconsistentSourceCoverageStatusesVerification.errors.some((error) =>
        error.includes(
          "source_coverage.csv row 3 collection_status collected_empty does not match snapshot_count/record_count expected collected",
        )
      ),
      true,
    );
    assertEquals(
      inconsistentSourceCoverageStatusesVerification.errors.some((error) =>
        error.includes(
          "source_coverage.csv row 3 release_status collected_empty does not match source_type/counts expected exported",
        )
      ),
      true,
    );
    manifest.sourceCoverageStatusCounts = originalSourceCoverageStatusCounts;
    manifestCounts.sourceCoverageStatuses = originalCountSourceCoverageStatuses;
    manifest.sourceCoverageReleaseStatusCounts = originalSourceCoverageReleaseStatusCounts;
    manifestCounts.sourceCoverageReleaseStatuses = originalCountSourceCoverageReleaseStatuses;
    manifest.sourceCoverageFamilyRollup = originalSourceCoverageFamilyRollup;

    await writeSourceCoverageWithManifestMetadata(originalSourceCoverage);
    const restoredSourceCoverageStatusVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredSourceCoverageStatusVerification.valid, true);

    const staleSourceCoverage = originalSourceCoverage.replace(
      ",collected,",
      ",not_collected,",
    );
    assertEquals(staleSourceCoverage === originalSourceCoverage, false);
    await writeSourceCoverageWithManifestMetadata(staleSourceCoverage);
    const staleSourceCoverageVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleSourceCoverageVerification.valid, false);
    assertEquals(
      staleSourceCoverageVerification.errors.some((error) =>
        error.includes(
          "source_coverage.csv collection_status counts must match manifest.sourceCoverageStatusCounts",
        )
      ),
      true,
    );
    assertEquals(
      staleSourceCoverageVerification.errors.some((error) =>
        error.includes("sha256 mismatch for sourceCoverageCsv")
      ),
      false,
    );

    await writeSourceCoverageWithManifestMetadata(originalSourceCoverage);
    const restoredVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredVerification.valid, true);

    const sourceCoverageFamilyRollup = manifest.sourceCoverageFamilyRollup as Array<
      Record<string, unknown>
    >;
    const originalFirstFamilyRowCount = sourceCoverageFamilyRollup[0].rows;
    sourceCoverageFamilyRollup[0].rows = Number(originalFirstFamilyRowCount) + 1;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleSourceFamilyRollupVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleSourceFamilyRollupVerification.valid, false);
    assertEquals(
      staleSourceFamilyRollupVerification.errors.some((error) =>
        error.includes(
          "source_coverage.csv family rollup must match manifest.sourceCoverageFamilyRollup",
        )
      ),
      true,
    );
    sourceCoverageFamilyRollup[0].rows = originalFirstFamilyRowCount;
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredRollupVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredRollupVerification.valid, true);

    const readme = await Deno.readTextFile(join(releaseRoot, "README.md"));
    assertEquals(readme.includes("# DC Civic Ledger"), true);
    assertEquals(readme.includes(`- Git HEAD: ${provenance.gitHeadCommit}`), false);
    assertEquals(readme.includes("- Export provenance: see [manifest.json](manifest.json)"), true);
    assertEquals(readme.includes("## Public CSVs"), true);
    assertEquals(readme.includes("- [dc_agencies.csv](dc_agencies.csv)"), true);
    assertEquals(
      readme.includes("- [dc_councilmembers.csv](dc_councilmembers.csv) (1 row)"),
      true,
    );
    assertEquals(
      readme.includes("- [dc_council_committees.csv](dc_council_committees.csv)"),
      true,
    );
    assertEquals(
      readme.includes(
        "- [dc_council_committee_memberships.csv](dc_council_committee_memberships.csv)",
      ),
      true,
    );
    assertEquals(readme.includes("- [dc_public_bodies.csv](dc_public_bodies.csv)"), true);
    assertEquals(
      readme.includes("- [dc_public_body_affiliations.csv](dc_public_body_affiliations.csv)"),
      true,
    );
    assertEquals(readme.includes("- [dc_smds.csv](dc_smds.csv)"), true);
    assertEquals(readme.includes("- [dc_relationships.csv](dc_relationships.csv)"), true);
    assertEquals(readme.includes("- [dc_sources.csv](dc_sources.csv)"), true);
    assertEquals(readme.includes("## Notes"), true);
    assertEquals(readme.includes("## Scope"), false);
    assertEquals(
      readme.includes("Does not try to be a complete legal"),
      false,
    );
    assertEquals(readme.includes("Not included: contacts"), false);
    assertEquals(
      readme.includes("Relations mean the source supported that link"),
      false,
    );
    assertEquals(
      readme.includes(
        "Relationship rows use public labels; trace CSVs keep raw `dc.relation:*` values.",
      ),
      false,
    );
    assertEquals(
      readme.includes("Blank cells mean no current source-backed value."),
      true,
    );
    assertEquals(
      readme.includes(
        "For complete relationship endpoint joins, use `govgraph_nodes.json` or `ledger.sqlite`",
      ),
      false,
    );
    assertEquals(
      readme.includes(
        "- Public-body near-duplicates stay distinct unless a tracked merge or suppression says otherwise.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "- `dc_councilmembers.csv` is the 13-member elected Council roster; `dc.council` in GovGraph counts means council-type public bodies.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "- Ledger entries can exceed GovGraph nodes because source/audit anchor kinds listed in `govgraph_summary.json` are not graph nodes.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "- Committee `member_count` includes chairs; Committee of the Whole has all 13 Councilmembers.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "`ledger.sqlite` includes the public tables plus audit tables; start with `release_table_catalog`.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "For audit and traceability in SQLite, use `ledger_entries`, `ledger_relations`, `ledger_citations`, and `source_coverage`",
      ),
      false,
    );
    assertEquals(
      readme.includes(
        "In SQLite, start with `release_table_catalog` to see table groups, row counts, and columns.",
      ),
      false,
    );
    assertEquals(
      readme.includes(
        "`manifest.json` lists upload assets, row counts, columns, and hashes.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "GovGraph: start with `govgraph_summary.json`, then use `govgraph_nodes.json` and `govgraph_edges.json`.",
      ),
      true,
    );
    assertEquals(readme.includes("## Machine Files"), true);
    assertEquals(readme.includes("## Other Upload Assets"), false);
    assertEquals(readme.includes("- `ledger_entries.csv`"), false);
    assertEquals(readme.includes("inspect ledger_citations.csv"), false);
    assertEquals(readme.includes("_local/ledger_citations.csv"), false);
    assertEquals(readme.includes("## Compatibility CSVs"), false);
    assertEquals(readme.includes("`_local/dc_board_affiliations.csv`"), false);
    assertEquals(readme.includes("`_local/dc_anc_smd_structure.csv`"), false);
    assertEquals(readme.includes("`_local/dc_smd_commissioners.csv`"), false);
    assertEquals(readme.includes("## Machine Assets"), false);
    assertEquals(
      readme.includes("public tables plus audit and helper tables"),
      false,
    );
    assertEquals(
      readme.includes(
        "- [ledger.sqlite](ledger.sqlite) - SQLite database with the public tables, audit tables, and a table catalog.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "- [SHA256SUMS](SHA256SUMS) - checksums for upload assets except `manifest.json` and `SHA256SUMS`.",
      ),
      true,
    );
    assertEquals(readme.includes("file sizes, hashes, row counts, columns"), true);
    assertEquals(
      readme.includes(
        "`dc_sources.csv` includes exported and inventory-only rows; check `release_status`.",
      ),
      false,
    );
    assertEquals(
      readme.includes(
        "`dc_public_bodies.csv` keeps Open DC profile URLs separate from official websites.",
      ),
      false,
    );
    assertEquals(readme.includes("release verify"), false);
    assertEquals(
      readme.includes(
        "Final publish gate: `deno task civic release verify --publish <release-root>`.",
      ),
      false,
    );
    assertEquals(readme.includes("## Release Checks"), true);
    assertEquals(
      readme.includes(
        "Review queue: 2 total; 0 blocking; 1 applied; 1 deferred.",
      ),
      true,
    );
    assertEquals(
      readme.includes("Sources: 4; exported / inventory-only / collected-empty 2 / 2 / 0."),
      true,
    );
    assertEquals(
      readme.includes(
        "Source inventory rows are in `dc_sources.csv`; collected source snapshot counts are in `_local/source_counts.csv` and `manifest.json` as `collectedSourceCount`.",
      ),
      false,
    );
    assertEquals(readme.includes("sha256sum -c SHA256SUMS"), true);
    assertEquals(readme.includes("shasum -a 256 -c SHA256SUMS"), true);

    const entriesRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv")),
    );
    const entriesById = new Map(entriesRows.slice(1).map((row) => [row[0], row]));
    assertEquals(entriesById.get("dc.board:b-1")?.[2], "dc.board");
    assertEquals(entriesById.get("dc.authority:au-1")?.[3], "Ethics Authority");

    const relationRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/ledger_relations.csv")),
    );
    assertEquals(relationRows.length, 10);
    const relationFromIds = new Set(relationRows.slice(1).map((row) => row[0]));
    assertEquals(relationFromIds.has("dc.board:b-1"), true);
    assertEquals(relationFromIds.has("dc.commission:c-1"), true);
    assertEquals(relationFromIds.has("dc.authority:au-1"), true);

    const relationKinds = relationRows.slice(1).reduce<Record<string, number>>((acc, row) => {
      const key = row[1];
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    assertEquals(relationKinds["dc.relation:governs"], 2);
    assertEquals(relationKinds["dc.relation:authorized_by"], 1);

    const sourceRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/source_counts.csv")),
    );
    assertEquals(sourceRows[1][0], "gazette");
    assertEquals(sourceRows[2][0], "registry");

    const sourceCoverageRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/source_coverage.csv")),
    );
    assertEquals(sourceCoverageRows[0], [
      "source",
      "source_type",
      "family",
      "publisher",
      "access_method",
      "source_url",
      "catalog_confidence",
      "collection_status",
      "reader_status",
      "interpreter_status",
      "release_status",
      "snapshot_count",
      "record_count",
      "citation_count",
      "scope",
      "contributes",
      "excludes",
      "notes",
    ]);
    const sourceCoverageBySource = new Map(sourceCoverageRows.slice(1).map((row) => [row[0], row]));
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[3], "Fixture Publisher");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[4], "Fixture backlog");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[5], "https://example.com/blocked");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[6], "medium");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[7], "not_collected");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[8], "inventory_only");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[9], "not_wired");
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[10], "inventory_only");
    assertEquals(sourceCoverageBySource.get("gazette")?.[7], "collected");
    assertEquals(sourceCoverageBySource.get("gazette")?.[8], "wired");
    assertEquals(sourceCoverageBySource.get("gazette")?.[9], "wired");
    assertEquals(sourceCoverageBySource.get("gazette")?.[10], "exported");
    assertEquals(sourceCoverageBySource.get("registry")?.[13], "7");

    const citationRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/ledger_citations.csv")),
    );
    assertEquals(citationRows.length, 13);
    assertEquals(citationRows[1][0], "entry");
    assertEquals(citationRows[1][1], "dc.agency:a-1");
    assertEquals(citationRows[2][6], "true");

    const boardAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/dc_board_affiliations.csv")),
    );
    assertEquals(boardAffiliations[1][0], "dc.board:b-1");
    assertEquals(boardAffiliations[1][3], "dc.agency:a-1");

    const commissionAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/dc_commission_affiliations.csv")),
    );
    assertEquals(commissionAffiliations[1][0], "dc.commission:c-1");

    const authorityAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/dc_authority_affiliations.csv")),
    );
    assertEquals(authorityAffiliations[1][0], "dc.authority:au-1");

    const ancSmdStructure = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/dc_anc_smd_structure.csv")),
    );
    assertEquals(ancSmdStructure[1][0], "dc.anc:8F");
    assertEquals(ancSmdStructure[1][3], "dc.smd:8F01");
    assertEquals(ancSmdStructure[1][5], "dc.anc_commissioner_seat:8F01");
    assertEquals(ancSmdStructure[1][7], "Nic Wilson");

    const councilCommitteeMembership = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_council_committee_memberships.csv")),
    );
    assertEquals(councilCommitteeMembership[0], [
      "committee_entry_id",
      "committee_name",
      "committee_type",
      "councilmember_entry_id",
      "councilmember_name",
      "membership_role",
      "source_url",
      "source_id",
    ]);
    assertEquals(councilCommitteeMembership[1][0], "dc.committee:transportation");
    assertEquals(councilCommitteeMembership[1][3], "dc.councilmember:jane-doe");
    assertEquals(councilCommitteeMembership[1][5], "chair");
    assertEquals(councilCommitteeMembership[1][6], "https://example.com/registry");
    assertEquals(councilCommitteeMembership[1][7], "registry:committee-transportation");

    const dcAgencies = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "dc_agencies.csv")));
    assertEquals(dcAgencies[0], [
      "agency_id",
      "name",
      "short_name",
      "official_url",
      "parent_id",
      "parent_name",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcAgencies[1][0], "dc.agency:a-1");
    assertEquals(dcAgencies[1][7], "gazette:a-1");

    const dcCouncilmembers = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_councilmembers.csv")),
    );
    assertEquals(dcCouncilmembers[0], [
      "sort_order",
      "councilmember_id",
      "name",
      "seat_type",
      "office_title",
      "ward",
      "is_at_large",
      "profile_url",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcCouncilmembers[1][1], "dc.councilmember:jane-doe");
    assertEquals(dcCouncilmembers[1][3], "unknown");

    const dcCouncilCommittees = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_council_committees.csv")),
    );
    assertEquals(dcCouncilCommittees[0], [
      "committee_id",
      "name",
      "committee_type",
      "chair_id",
      "chair_name",
      "member_count",
      "members",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcCouncilCommittees[1][0], "dc.committee:transportation");
    assertEquals(dcCouncilCommittees[1][3], "dc.councilmember:jane-doe");
    assertEquals(dcCouncilCommittees[1][5], "1");
    assertEquals(dcCouncilCommittees[1][6], "Jane Doe");

    const dcPublicBodies = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_public_bodies.csv")),
    );
    assertEquals(dcPublicBodies.length, 4);
    assertEquals(dcPublicBodies[1][2], "authority");
    assertEquals(dcPublicBodies[1][9], "dc.agency:a-1");
    assertEquals(dcPublicBodies[1][10], "District Agency");
    assertEquals(dcPublicBodies[2][5], "D.C. Code § 3-1301");
    assertEquals(
      dcPublicBodies[2][6],
      "https://code.dccouncil.gov/us/dc/council/code/sections/3-1301",
    );

    const dcPublicBodyAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_public_body_affiliations.csv")),
    );
    assertEquals(dcPublicBodyAffiliations.length, 4);
    assertEquals(dcPublicBodyAffiliations[0], [
      "public_body_id",
      "public_body_name",
      "body_type",
      "relation_type",
      "target_id",
      "target_name",
      "target_type",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcPublicBodyAffiliations[1][3], "administered_by");
    assertEquals(dcPublicBodyAffiliations[1][4], "dc.agency:a-1");

    const dcAncs = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "dc_ancs.csv")));
    assertEquals(dcAncs[0], [
      "anc_id",
      "anc",
      "official_url",
      "oanc_profile_url",
      "wards",
      "neighborhoods",
      "smd_count",
      "current_commissioners",
      "current_state_note",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcAncs[1][0], "dc.anc:8F");
    assertEquals(dcAncs[1][6], "1");
    assertEquals(dcAncs[1][7], "Nic Wilson");
    assertEquals(
      dcAncs[1][8],
      "OANC lists this as ANC 6/8F; the release keeps the DCGIS ANC 8F ID.",
    );

    const dcSmds = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "dc_smds.csv")));
    assertEquals(dcSmds[1][0], "dc.smd:8F01");
    assertEquals(dcSmds[1][4], "");
    assertEquals(dcSmds[1][6], "Nic Wilson");
    assertEquals(dcSmds[1][8], "https://example.com/registry");

    const dcSmdCommissioners = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/dc_smd_commissioners.csv")),
    );
    assertEquals(dcSmdCommissioners[0], [
      "smd",
      "anc",
      "wards",
      "current_commissioner_name",
      "officer_role",
      "smd_id",
      "anc_id",
      "commissioner_seat_id",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcSmdCommissioners[1][0], "8F01");
    assertEquals(dcSmdCommissioners[1][1], "8F");
    assertEquals(dcSmdCommissioners[1][3], "Nic Wilson");
    assertEquals(dcSmdCommissioners[1][8], "https://example.com/registry");

    const dcRelationships = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_relationships.csv")),
    );
    assertEquals(dcRelationships[0], [
      "from_id",
      "from_name",
      "from_type",
      "relationship",
      "to_id",
      "to_name",
      "to_type",
      "source_url",
      "source_id",
    ]);
    assertEquals(dcRelationships.length, 10);
    assertEquals(
      dcRelationships.some((row) =>
        row[0] === "dc.board:b-1" &&
        row[3] === "authorized_by" &&
        row[4] === "dc.legal_authority:d-c-code-3-1301" &&
        row[5] === "D.C. Code § 3-1301"
      ),
      true,
    );
    assertEquals(
      dcRelationships.some((row) =>
        row[0] === "dc.councilmember:jane-doe" &&
        row[3] === "member_of" &&
        row[4] === "dc.committee:transportation" &&
        row[5] === "Committee on Transportation"
      ),
      true,
    );
    assertEquals(
      dcRelationships.some((row) =>
        row[0] === "dc.board:b-1" &&
        row[3] === "administered_by" &&
        row[4] === "dc.agency:a-1"
      ),
      true,
    );

    const dcSources = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "dc_sources.csv")));
    assertEquals(dcSources.length, 5);
    assertEquals(dcSources[0], [
      "source_id",
      "publisher",
      "source_url",
      "family",
      "access_method",
      "collection_status",
      "release_status",
      "record_count",
      "citation_count",
      "scope",
      "contributes",
      "known_limits",
      "notes",
    ]);
    assertEquals(dcSources[1][0], "blocked.source");
    assertEquals(dcSources[1][5], "not_collected");
    assertEquals(dcSources[1][6], "inventory_only");

    const dcAgenciesOutputPath = manifestOutputs.dcAgenciesCsv;
    const dcAgenciesPath = join(releaseRoot, dcAgenciesOutputPath);
    const originalDcAgenciesBytes = await Deno.readFile(dcAgenciesPath);
    const staleDcAgenciesText = new TextDecoder().decode(originalDcAgenciesBytes).replace(
      "agency_id,name",
      "agency_id,label",
    );
    const staleDcAgenciesBytes = new TextEncoder().encode(staleDcAgenciesText);
    await Deno.writeFile(dcAgenciesPath, staleDcAgenciesBytes);
    outputFileMetadata.dcAgenciesCsv.byteSize = staleDcAgenciesBytes.byteLength;
    outputFileMetadata.dcAgenciesCsv.sha256 = await sha256Hex(staleDcAgenciesBytes);
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const stalePublicHeaderVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(stalePublicHeaderVerification.valid, false);
    assertEquals(
      stalePublicHeaderVerification.errors.some((error) =>
        error.includes("dc_agencies.csv headers must match the release CSV contract")
      ),
      true,
    );
    await Deno.writeFile(dcAgenciesPath, originalDcAgenciesBytes);
    outputFileMetadata.dcAgenciesCsv.byteSize = originalDcAgenciesBytes.byteLength;
    outputFileMetadata.dcAgenciesCsv.sha256 = await sha256Hex(originalDcAgenciesBytes);
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredPublicHeaderVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredPublicHeaderVerification.valid, true);

    const govGraphNodes = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_nodes.json")),
    ) as Array<Record<string, unknown>>;
    assertEquals(govGraphNodes.length, 10);
    assertEquals(govGraphNodes[0].publicStatus, "published");

    const govGraphEdges = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_edges.json")),
    ) as Array<Record<string, unknown>>;
    assertEquals(govGraphEdges.length, 8);
    assertEquals(
      govGraphEdges.some((edge) =>
        edge.relationKind === "dc.relation:authorized_by" && edge.verb === "authorized_by"
      ),
      true,
    );
    assertEquals(
      govGraphEdges.some((edge) =>
        edge.relationKind === "dc.relation:governs" && edge.verb === "administered_by"
      ),
      true,
    );
    assertEquals(
      govGraphEdges.some((edge) => edge.relationKind === "dc.relation:oversees"),
      false,
    );

    const govGraphSummary = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_summary.json")),
    ) as Record<string, unknown>;
    assertEquals(govGraphSummary.nodeKindCounts, {
      "dc.agency": 1,
      "dc.anc": 1,
      "dc.anc_commissioner_seat": 1,
      "dc.authority": 1,
      "dc.board": 1,
      "dc.commission": 1,
      "dc.committee": 1,
      "dc.councilmember": 1,
      "dc.legal_authority": 1,
      "dc.smd": 1,
    });
    assertEquals(govGraphSummary.nodeCategoryCounts, {
      executive: 1,
      legal_authority: 1,
      legislative: 1,
      neighborhood: 3,
      public_body: 3,
      representation: 1,
    });
    assertEquals(govGraphSummary.nonGraphLedgerEntryKinds, {});
    assertEquals(
      govGraphSummary.nonGraphLedgerEntryNote,
      "Ledger entries in nonGraphLedgerEntryKinds are source or audit anchors and are intentionally not projected as GovGraph nodes.",
    );
    assertEquals(govGraphSummary.edgeVerbCounts, {
      administered_by: 2,
      affiliated_with: 1,
      authorized_by: 1,
      chairs: 1,
      contains: 1,
      member_of: 1,
      represents: 1,
    });
    assertEquals(govGraphSummary.excludedNodeCount, 0);
    assertEquals(govGraphSummary.excludedEdgeCount, 1);
    assertEquals(govGraphSummary.releaseBlockingReviewItemCount, 0);
    assertEquals(govGraphSummary.nonBlockingDeferredReviewItemCount, 1);
    assertEquals(govGraphSummary.reviewPosture, {
      releaseBlockingReviewItemCount: 0,
      nonBlockingDeferredReviewItemCount: 1,
      note:
        "releaseBlockingReviewItemCount must be zero for release; nonBlockingDeferredReviewItemCount records deferred review work that is outside the current public-output release path.",
    });
    assertEquals(govGraphSummary.reviewQueueCounts, {
      blocking: 0,
      actionable: 0,
      drafted: 0,
      applied: 1,
      deferred: 1,
    });
    assertEquals(
      (manifest.govGraph as Record<string, unknown>).reviewQueueCounts,
      govGraphSummary.reviewQueueCounts,
    );
    assertEquals(govGraphSummary.mappedRelationCount, 2);
    assertEquals(govGraphSummary.mappedRelationCounts, [{
      relationKind: "dc.relation:governs",
      verb: "administered_by",
      count: 2,
    }]);
    const nodeFieldDescriptions = govGraphSummary.nodeFieldDescriptions as Record<string, string>;
    const edgeFieldDescriptions = govGraphSummary.edgeFieldDescriptions as Record<string, string>;
    const citationFieldDescriptions = govGraphSummary.citationFieldDescriptions as Record<
      string,
      string
    >;
    const joinRules = govGraphSummary.joinRules as string[];
    assertEquals(
      nodeFieldDescriptions.id,
      "Stable GovGraph node ID; equals ledgerId for this release.",
    );
    assertEquals(
      edgeFieldDescriptions.from,
      "Source node ID; joins to govgraph_nodes.json id.",
    );
    assertEquals(citationFieldDescriptions.url, "Source URL when available.");
    assertEquals(
      joinRules.includes(
        "dc.councilmember is the elected Council member kind; dc.council is a council-type public body kind.",
      ),
      true,
    );
    assertEquals(
      joinRules.includes(
        "Ledger entry counts can exceed GovGraph node counts because source/audit anchor kinds listed in nonGraphLedgerEntryKinds are not graph nodes.",
      ),
      true,
    );
    assertEquals(govGraphSummary.relationFieldDescriptions, {
      relationKind: "Stable raw ledger relation identifier.",
      verb: "Public relationship label for release consumers.",
    });

    const govGraphSummaryOutputPath = manifestOutputs.govGraphSummaryJson;
    const originalGovGraphSummaryBytes = new TextEncoder().encode(
      JSON.stringify(govGraphSummary, null, 2) + "\n",
    );
    const staleGovGraphRollups = {
      ...govGraphSummary,
      nodeKindCounts: {},
      edgeVerbCounts: {},
    };
    const staleGovGraphRollupBytes = new TextEncoder().encode(
      JSON.stringify(staleGovGraphRollups, null, 2) + "\n",
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      staleGovGraphRollupBytes,
    );
    manifest.govGraph = staleGovGraphRollups;
    outputFileMetadata.govGraphSummaryJson.byteSize = staleGovGraphRollupBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(
      staleGovGraphRollupBytes,
    );
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleGovGraphRollupVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleGovGraphRollupVerification.valid, false);
    assertEquals(
      staleGovGraphRollupVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.nodeCount 10 does not match govgraph_summary.json.nodeKindCounts total 0",
        )
      ),
      true,
    );
    assertEquals(
      staleGovGraphRollupVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.edgeCount 8 does not match govgraph_summary.json.edgeVerbCounts total 0",
        )
      ),
      true,
    );
    assertEquals(
      staleGovGraphRollupVerification.errors.some((error) =>
        error.includes("sha256 mismatch for govGraphSummaryJson")
      ),
      false,
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      originalGovGraphSummaryBytes,
    );
    manifest.govGraph = govGraphSummary;
    outputFileMetadata.govGraphSummaryJson.byteSize = originalGovGraphSummaryBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(
      originalGovGraphSummaryBytes,
    );
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredGovGraphRollupVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredGovGraphRollupVerification.valid, true);

    const staleGovGraphPayloadCounts = {
      ...govGraphSummary,
      nodeCount: 8,
      nodeKindCounts: {
        ...(govGraphSummary.nodeKindCounts as Record<string, number>),
        "dc.agency": 0,
      },
      nodeCategoryCounts: {
        ...(govGraphSummary.nodeCategoryCounts as Record<string, number>),
        executive: 0,
      },
      edgeCount: 6,
      edgeVerbCounts: {
        ...(govGraphSummary.edgeVerbCounts as Record<string, number>),
        administered_by: 1,
      },
    };
    const staleGovGraphPayloadCountBytes = new TextEncoder().encode(
      JSON.stringify(staleGovGraphPayloadCounts, null, 2) + "\n",
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      staleGovGraphPayloadCountBytes,
    );
    manifest.govGraph = staleGovGraphPayloadCounts;
    outputFileMetadata.govGraphSummaryJson.byteSize = staleGovGraphPayloadCountBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(
      staleGovGraphPayloadCountBytes,
    );
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleGovGraphPayloadCountVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleGovGraphPayloadCountVerification.valid, false);
    assertEquals(
      staleGovGraphPayloadCountVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.nodeCount 8 does not match govgraph_nodes.json array length 10",
        )
      ),
      true,
    );
    assertEquals(
      staleGovGraphPayloadCountVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.edgeCount 6 does not match govgraph_edges.json array length 8",
        )
      ),
      true,
    );
    assertEquals(
      staleGovGraphPayloadCountVerification.errors.some((error) =>
        error.includes("sha256 mismatch for govGraphSummaryJson")
      ),
      false,
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      originalGovGraphSummaryBytes,
    );
    manifest.govGraph = govGraphSummary;
    outputFileMetadata.govGraphSummaryJson.byteSize = originalGovGraphSummaryBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(
      originalGovGraphSummaryBytes,
    );
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredGovGraphPayloadCountVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredGovGraphPayloadCountVerification.valid, true);

    const blockedGovGraphSummary = {
      ...govGraphSummary,
      blockedReviewItemCount: 1,
      blockedReviewCountsByCategory: { kind_conflict: 1 },
    };
    const blockedGovGraphSummaryBytes = new TextEncoder().encode(
      JSON.stringify(blockedGovGraphSummary, null, 2) + "\n",
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      blockedGovGraphSummaryBytes,
    );
    manifest.govGraph = blockedGovGraphSummary;
    outputFileMetadata.govGraphSummaryJson.byteSize = blockedGovGraphSummaryBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(
      blockedGovGraphSummaryBytes,
    );
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const blockedReviewVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(blockedReviewVerification.valid, false);
    assertEquals(
      blockedReviewVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.blockedReviewItemCount must be 0 for release verification, found 1",
        )
      ),
      true,
    );
    assertEquals(
      blockedReviewVerification.errors.some((error) =>
        error.includes("sha256 mismatch for govGraphSummaryJson")
      ),
      false,
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      originalGovGraphSummaryBytes,
    );
    manifest.govGraph = govGraphSummary;
    outputFileMetadata.govGraphSummaryJson.byteSize = originalGovGraphSummaryBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(
      originalGovGraphSummaryBytes,
    );
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const restoredBlockedReviewVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(restoredBlockedReviewVerification.valid, true);

    const staleGovGraphSummary = { ...govGraphSummary };
    delete staleGovGraphSummary.nodeKindCounts;
    delete staleGovGraphSummary.nodeCategoryCounts;
    const staleGovGraphSummaryBytes = new TextEncoder().encode(
      JSON.stringify(staleGovGraphSummary, null, 2) + "\n",
    );
    await Deno.writeFile(
      join(releaseRoot, govGraphSummaryOutputPath),
      staleGovGraphSummaryBytes,
    );
    manifest.govGraph = staleGovGraphSummary;
    outputFileMetadata.govGraphSummaryJson.byteSize = staleGovGraphSummaryBytes.byteLength;
    outputFileMetadata.govGraphSummaryJson.sha256 = await sha256Hex(staleGovGraphSummaryBytes);
    await Deno.writeTextFile(
      join(releaseRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    const staleSchemaVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(staleSchemaVerification.valid, false);
    assertEquals(
      staleSchemaVerification.errors.some((error) =>
        error.includes("manifest.govGraph.nodeKindCounts must be an object")
      ),
      true,
    );
    assertEquals(
      staleSchemaVerification.errors.some((error) =>
        error.includes("govgraph_summary.json.nodeKindCounts must be an object")
      ),
      true,
    );
    assertEquals(
      staleSchemaVerification.errors.some((error) =>
        error.includes("sha256 mismatch for govGraphSummaryJson")
      ),
      false,
    );

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      assertEquals(countRows(ledgerDb, "ledger_entries"), 10);
      assertEquals(countRows(ledgerDb, "ledger_relations"), 9);
      assertEquals(countRows(ledgerDb, "ledger_citations"), 12);
      assertEquals(countRows(ledgerDb, "source_counts"), 2);
      assertEquals(countRows(ledgerDb, "source_coverage"), 4);
      assertEquals(countRows(ledgerDb, "dc_anc_smd_structure"), 1);
      assertEquals(countRows(ledgerDb, "dc_board_affiliations"), 1);
      assertEquals(countRows(ledgerDb, "dc_commission_affiliations"), 1);
      assertEquals(countRows(ledgerDb, "dc_authority_affiliations"), 1);
      assertEquals(countRows(ledgerDb, "dc_council_committee_memberships"), 1);
      assertEquals(countRows(ledgerDb, "dc_agencies"), 1);
      assertEquals(countRows(ledgerDb, "dc_councilmembers"), 1);
      assertEquals(countRows(ledgerDb, "dc_council_committees"), 1);
      assertEquals(countRows(ledgerDb, "dc_public_bodies"), 3);
      assertEquals(countRows(ledgerDb, "entries"), 10);
      assertEquals(countRows(ledgerDb, "relations"), 9);
      assertEquals(countRows(ledgerDb, "citations"), 12);
      assertEquals(countRows(ledgerDb, "sources"), 2);
      assertEquals(countRows(ledgerDb, "dc_public_body_affiliations"), 3);
      assertEquals(countRows(ledgerDb, "dc_ancs"), 1);
      assertEquals(countRows(ledgerDb, "dc_smds"), 1);
      assertEquals(countRows(ledgerDb, "dc_smd_commissioners"), 1);
      assertEquals(countRows(ledgerDb, "dc_legal_authorities"), 1);
      assertEquals(countRows(ledgerDb, "dc_relationships"), 9);
      assertEquals(countRows(ledgerDb, "dc_sources"), 4);
      assertEquals(countRows(ledgerDb, "release_table_catalog"), 29);
      assertEquals(sqliteTableExists(ledgerDb, "dc_council_committee_membership"), false);
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT table_group FROM release_table_catalog WHERE table_name = ?",
          ["dc_agencies"],
        ),
        "public",
      );
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT release_path FROM release_table_catalog WHERE table_name = ?",
          ["dc_agencies"],
        ),
        "dc_agencies.csv",
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT is_release_asset FROM release_table_catalog WHERE table_name = ?",
          ["dc_agencies"],
        ),
        1,
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT row_count FROM release_table_catalog WHERE table_name = ?",
          ["dc_agencies"],
        ),
        1,
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT column_count FROM release_table_catalog WHERE table_name = ?",
          ["dc_agencies"],
        ),
        8,
      );
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT table_group FROM release_table_catalog WHERE table_name = ?",
          ["ledger_entries"],
        ),
        "traceability",
      );
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT release_path FROM release_table_catalog WHERE table_name = ?",
          ["ledger_entries"],
        ),
        "_local/ledger_entries.csv",
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT is_release_asset FROM release_table_catalog WHERE table_name = ?",
          ["ledger_entries"],
        ),
        0,
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT row_count FROM release_table_catalog WHERE table_name = ?",
          ["ledger_entries"],
        ),
        10,
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT column_count FROM release_table_catalog WHERE table_name = ?",
          ["ledger_entries"],
        ),
        6,
      );
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT columns_json FROM release_table_catalog WHERE table_name = ?",
          ["ledger_entries"],
        ),
        JSON.stringify(["entry_id", "family", "kind", "name", "attributes", "citations"]),
      );
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT table_group FROM release_table_catalog WHERE table_name = ?",
          ["dc_board_affiliations"],
        ),
        "compatibility",
      );
      assertEquals(sqliteTableExists(ledgerDb, "dc_board_affiliations"), true);
      assertEquals(sqliteTableExists(ledgerDb, "dc_commission_affiliations"), true);
      assertEquals(sqliteTableExists(ledgerDb, "dc_authority_affiliations"), true);
      assertEquals(
        sqliteScalarString(
          ledgerDb,
          "SELECT table_kind FROM release_table_catalog WHERE table_name = ?",
          ["entries"],
        ),
        "view",
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT row_count FROM release_table_catalog WHERE table_name = ?",
          ["release_table_catalog"],
        ),
        29,
      );
      assertEquals(
        sqliteScalarInteger(
          ledgerDb,
          "SELECT row_count FROM release_table_catalog WHERE table_name = ?",
          ["entries"],
        ),
        10,
      );
      assertEquals(sqliteColumnTypes(ledgerDb, "dc_sources").record_count, "INTEGER");
      assertEquals(sqliteColumnTypes(ledgerDb, "dc_sources").citation_count, "INTEGER");
      assertEquals(sqliteColumnTypes(ledgerDb, "dc_council_committees").member_count, "INTEGER");
      assertEquals(sqliteColumnTypes(ledgerDb, "dc_ancs").smd_count, "INTEGER");
      assertEquals(sqliteColumnTypes(ledgerDb, "dc_legal_authorities").used_by_count, "INTEGER");
    } finally {
      ledgerDb.close();
    }

    await Deno.writeTextFile(join(releaseRoot, "_local/ledger_entries.csv"), "tampered\n");
    const tamperedVerification = await verifyReleaseArtifacts(releaseRoot);
    assertEquals(tamperedVerification.valid, false);
    assertEquals(
      tamperedVerification.errors.some((error) => error.includes("sha256 mismatch for entriesCsv")),
      true,
    );
  } finally {
    closeWorkspace(workspace);
    await Deno.remove(workspaceRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("exportReleaseArtifacts explains collected-empty authority entity coverage", async () => {
  const workspaceRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-export-test-empty-authorities-",
  });
  const releaseRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-export-result-empty-authorities-",
  });

  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  try {
    workspace.db.run(
      "INSERT INTO snapshots (source, snapshot_key, payload) VALUES (?, ?, ?)",
      [
        "dcgis.authorities",
        "snapshot-2026-01-01",
        JSON.stringify({ source: "dcgis.authorities", sourceType: "arcgis.table" }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_entries (entry_id, jurisdiction, kind, payload) VALUES (?, ?, ?, ?)",
      [
        "dc.agency:a-1",
        "dc",
        "dc.agency",
        JSON.stringify({
          family: "organization",
          kind: "dc.agency",
          name: "Agency One",
          citations: [],
          attributes: { shortName: "AO" },
        }),
      ],
    );

    await exportReleaseArtifacts({
      workspace,
      jurisdiction: "dc",
      releaseRoot,
      sourceCatalog: [{
        source: "dcgis.authorities",
        sourceType: "arcgis.table",
        family: "public_bodies",
        publisher: "DCGIS / OCTO",
        accessMethod: "ArcGIS REST table",
        sourceUrl: "https://example.com/dcgis-authorities",
        catalogConfidence: "high",
        scope: "DCGIS authority fixture.",
        contributes: "Authority entries when rows are present.",
        excludes: "Boards, commissions, councils, and contacts.",
      }],
      sourceCoverageStats: [
        { source: "dcgis.authorities", snapshotCount: 1, recordCount: 0, citationCount: 0 },
      ],
    });

    const readme = await Deno.readTextFile(join(releaseRoot, "README.md"));
    assertEquals(
      readme.includes(
        "DCGIS authorities were collected empty; this release has zero `dc.authority` rows from that source.",
      ),
      true,
    );
  } finally {
    closeWorkspace(workspace);
    await Deno.remove(workspaceRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

function makeReviewItem(options: {
  id: string;
  category: ReviewItem["category"];
  classification: ReviewItem["classification"];
  status: ReviewItem["status"];
  findingCode?: string;
}): ReviewItem {
  return {
    id: options.id,
    category: options.category,
    classification: options.classification,
    severity: "low",
    confidence: "medium",
    status: options.status,
    title: "fixture review item",
    summary: "fixture review item",
    sourceFamilies: ["fixture"],
    affected: {
      fragmentIds: [],
      baselineIds: [],
      stateIds: [],
      relationEndpoints: [],
    },
    candidateEntries: [],
    sourceRefs: [],
    citations: [],
    urls: [],
    legalLocators: [],
    attributesThatAgree: {},
    attributesThatConflict: options.findingCode ? { findingCode: options.findingCode } : {},
    suggestedResolutions: ["suppress"],
    blocks: {
      stateGeneration: false,
      releaseReadiness: false,
    },
    draftRevisionIds: [],
    trackedRevisionIds: [],
    rationale: "fixture review item",
    generatedAt: "2026-06-16T00:00:00.000Z",
    source: {
      type: "finding",
      id: options.id,
    },
  };
}

Deno.test("exportReleaseArtifacts marks the Council Chairman as elected at-large", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "civic-ledger-export-test-chairman-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-export-result-chairman-" });

  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  try {
    workspace.db.run(
      "INSERT INTO state_entries (entry_id, jurisdiction, kind, payload) VALUES (?, ?, ?, ?)",
      [
        "dc.councilmember:phil-mendelson",
        "dc",
        "dc.councilmember",
        JSON.stringify({
          family: "person",
          kind: "dc.councilmember",
          name: "Phil Mendelson",
          citations: [
            {
              source: "dccouncil.members",
              sourceRecordId: "phil-mendelson",
              url: "https://dccouncil.gov/council/phil-mendelson/",
            },
          ],
          attributes: {
            officeLabel: "Chairman",
            sourceProfileUrl: "https://dccouncil.gov/council/phil-mendelson/",
          },
        }),
      ],
    );

    await exportReleaseArtifacts({
      workspace,
      jurisdiction: "dc",
      releaseRoot,
    });

    const rows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_councilmembers.csv")),
    );
    assertEquals(rows[0], [
      "sort_order",
      "councilmember_id",
      "name",
      "seat_type",
      "office_title",
      "ward",
      "is_at_large",
      "profile_url",
      "source_url",
      "source_id",
    ]);
    assertEquals(rows[1][1], "dc.councilmember:phil-mendelson");
    assertEquals(rows[1][3], "chairman");
    assertEquals(rows[1][4], "Chairman");
    assertEquals(rows[1][6], "true");
  } finally {
    closeWorkspace(workspace);
    await Deno.remove(workspaceRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("exportReleaseArtifacts tolerates malformed citation payloads", async () => {
  const workspaceRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-export-test-bad-citations-",
  });
  const releaseRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-export-result-bad-citations-",
  });

  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  try {
    workspace.db.run(
      "INSERT INTO snapshots (source, snapshot_key, payload) VALUES (?, ?, ?)",
      [
        "registry",
        "snapshot-2026-01-01",
        JSON.stringify({ source: "dc", sourceType: "registry" }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_entries (entry_id, jurisdiction, kind, payload) VALUES (?, ?, ?, ?)",
      [
        "dc.agency:a-1",
        "dc",
        "dc.agency",
        JSON.stringify({
          family: "organization",
          kind: "dc.agency",
          name: "Agency One",
          citations: { bad: "not an array" },
          attributes: { shortName: "AO" },
        }),
      ],
    );

    workspace.db.run(
      "INSERT INTO state_relations (from_entry_id, relation_kind, to_entry_id, citations) VALUES (?, ?, ?, ?)",
      [
        "dc.agency:a-1",
        "dc.relation:oversees",
        "dc.agency:a-2",
        "bad-citation-string",
      ],
    );

    const result = await exportReleaseArtifacts({
      workspace,
      jurisdiction: "dc",
      releaseRoot,
    });

    assertEquals(result.entryCount, 1);
    assertEquals(result.relationCount, 1);
    assertEquals(result.citationCount, 0);
    assertEquals(result.sourceCount, 1);
    assertEquals(result.sourceCoverageCount, 1);
    assertEquals(result.boardAffiliationCount, 0);
    assertEquals(result.commissionAffiliationCount, 0);
    assertEquals(result.authorityAffiliationCount, 0);
    assertEquals(result.ancSmdStructureCount, 0);
    assertEquals(result.councilCommitteeMembershipCount, 0);
    assertEquals(result.govGraphNodeCount, 1);
    assertEquals(result.govGraphEdgeCount, 0);
    assertEquals(result.govGraphExcludedNodeCount, 0);
    assertEquals(result.govGraphExcludedEdgeCount, 1);
    assertEquals(result.govGraphBlockedReviewItemCount, 0);

    const citationsRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/ledger_citations.csv")),
    );
    assertEquals(citationsRows.length, 1);
    assertEquals(citationsRows[0][0], "citation_type");

    const sourceRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/source_counts.csv")),
    );
    assertEquals(sourceRows.length, 2);
    assertEquals(sourceRows[1][0], "registry");
    assertEquals(sourceRows[1][2], "0");

    const sourceCoverageRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "_local/source_coverage.csv")),
    );
    assertEquals(sourceCoverageRows.length, 2);
    assertEquals(sourceCoverageRows[1][0], "registry");
    assertEquals(sourceCoverageRows[1][3], "");
    assertEquals(sourceCoverageRows[1][4], "");
    assertEquals(sourceCoverageRows[1][5], "");
    assertEquals(sourceCoverageRows[1][6], "");
    assertEquals(sourceCoverageRows[1][7], "collected_empty");
    assertEquals(sourceCoverageRows[1][8], "uncataloged");
    assertEquals(sourceCoverageRows[1][9], "unknown");
    assertEquals(sourceCoverageRows[1][10], "collected_empty");

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      assertEquals(countRows(ledgerDb, "ledger_citations"), 0);
      assertEquals(countRows(ledgerDb, "source_counts"), 1);
      assertEquals(countRows(ledgerDb, "source_coverage"), 1);
    } finally {
      ledgerDb.close();
    }
  } finally {
    closeWorkspace(workspace);
    await Deno.remove(workspaceRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

function parseCsvRows(contents: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < contents.length; index++) {
    const character = contents[index];

    if (inQuotes) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (character === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    if (character !== "\r") {
      currentField += character;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function countRows(db: Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function sqliteColumnTypes(db: Database, table: string): Record<string, string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.name, row.type]));
}

function sqliteTableExists(db: Database, table: string): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
  ).get(table) as { count: number };
  return row.count > 0;
}

function sqliteScalarString(db: Database, sql: string, params: string[]): string {
  const row = db.prepare(sql).get(...params) as Record<string, unknown>;
  return String(Object.values(row)[0] ?? "");
}

function sqliteScalarInteger(db: Database, sql: string, params: string[]): number {
  const row = db.prepare(sql).get(...params) as Record<string, unknown>;
  return Number(Object.values(row)[0] ?? 0);
}

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
