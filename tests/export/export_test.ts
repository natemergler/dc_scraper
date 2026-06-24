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
          attributes: { shortName: "CB", alias: "Board One" },
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
          attributes: { shortName: "8F" },
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

    assertEquals(result.entryCount, 9);
    assertEquals(result.relationCount, 8);
    assertEquals(result.citationCount, 11);
    assertEquals(result.sourceCount, 2);
    assertEquals(result.sourceCoverageCount, 4);
    assertEquals(result.boardAffiliationCount, 1);
    assertEquals(result.commissionAffiliationCount, 1);
    assertEquals(result.authorityAffiliationCount, 1);
    assertEquals(result.ancSmdStructureCount, 1);
    assertEquals(result.councilCommitteeMembershipCount, 1);
    assertEquals(result.govGraphNodeCount, 9);
    assertEquals(result.govGraphEdgeCount, 7);
    assertEquals(result.govGraphExcludedNodeCount, 0);
    assertEquals(result.govGraphExcludedEdgeCount, 1);
    assertEquals(result.govGraphBlockedReviewItemCount, 0);

    const expectedFiles = [
      "entries.csv",
      "relations.csv",
      "citations.csv",
      "sources.csv",
      "source_coverage.csv",
      "dc_board_affiliations.csv",
      "dc_commission_affiliations.csv",
      "dc_authority_affiliations.csv",
      "dc_anc_smd_structure.csv",
      "dc_council_committee_membership.csv",
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

    const manifest = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "manifest.json")),
    ) as Record<string, unknown>;
    assertEquals(manifest.jurisdiction, "dc");
    assertEquals(manifest.schemaVersion, 1);
    assertEquals((manifest.counts as Record<string, unknown>).entries, 9);
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
        "dc.smd": 1,
      },
    );
    assertEquals((manifest.counts as Record<string, unknown>).relations, 8);
    assertEquals(
      (manifest.counts as Record<string, unknown>).relationKinds,
      {
        "dc.relation:affiliated_with": 1,
        "dc.relation:chairs": 1,
        "dc.relation:contains": 1,
        "dc.relation:governs": 2,
        "dc.relation:member_of": 1,
        "dc.relation:oversees": 1,
        "dc.relation:represents": 1,
      },
    );
    assertEquals((manifest.counts as Record<string, unknown>).citations, 11);
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
    assertEquals((manifest.counts as Record<string, unknown>).govGraphNodes, 9);
    assertEquals((manifest.counts as Record<string, unknown>).govGraphEdges, 7);
    assertEquals((manifest.govGraph as Record<string, unknown>).nodeKindCounts, {
      "dc.agency": 1,
      "dc.anc": 1,
      "dc.anc_commissioner_seat": 1,
      "dc.authority": 1,
      "dc.board": 1,
      "dc.commission": 1,
      "dc.committee": 1,
      "dc.councilmember": 1,
      "dc.smd": 1,
    });
    assertEquals((manifest.govGraph as Record<string, unknown>).nodeCategoryCounts, {
      executive: 1,
      legislative: 1,
      neighborhood: 3,
      public_body: 3,
      representation: 1,
    });
    assertEquals(
      (manifest.outputs as Record<string, unknown>).sourceCoverageCsv,
      "source_coverage.csv",
    );
    assertEquals(
      (manifest.outputs as Record<string, unknown>).govGraphNodesJson,
      "govgraph_nodes.json",
    );
    assertEquals(
      (manifest.outputs as Record<string, unknown>).ancSmdStructureCsv,
      "dc_anc_smd_structure.csv",
    );
    assertEquals(
      (manifest.outputs as Record<string, unknown>).councilCommitteeMembershipCsv,
      "dc_council_committee_membership.csv",
    );

    const manifestOutputs = manifest.outputs as Record<string, string>;
    assertEquals(manifestOutputs.readme, "README.md");
    assertEquals("manifestJson" in manifestOutputs, false);
    for (const outputPath of Object.values(manifestOutputs)) {
      assertEquals(await exists(join(releaseRoot, outputPath)), true);
    }
    assertEquals(
      (manifest.counts as Record<string, unknown>).outputFiles,
      Object.keys(manifestOutputs).length,
    );
    const outputFileMetadata = manifest.outputFileMetadata as Record<
      string,
      { path: string; byteSize: number; sha256: string }
    >;
    assertEquals(
      Object.keys(outputFileMetadata).sort(),
      Object.keys(manifestOutputs).sort(),
    );
    assertEquals("manifestJson" in outputFileMetadata, false);
    for (const [outputName, outputPath] of Object.entries(manifestOutputs)) {
      const metadata = outputFileMetadata[outputName];
      const bytes = await Deno.readFile(join(releaseRoot, outputPath));
      assertEquals(metadata.path, outputPath);
      assertEquals(metadata.byteSize, bytes.byteLength);
      assertEquals(metadata.sha256, await sha256Hex(bytes));
      assertEquals(/^[0-9a-f]{64}$/.test(metadata.sha256), true);
    }
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
          `counts.entries ${Number(originalEntryCount) + 1} does not match entries.csv data rows ${
            Number(originalEntryCount)
          }`,
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
        error.includes("entries.csv kind counts must match manifest.counts.entryKinds")
      ),
      true,
    );
    assertEquals(
      staleKindRollupVerification.errors.some((error) =>
        error.includes(
          "relations.csv relation_kind counts must match manifest.counts.relationKinds",
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
    assertEquals(readme.includes("## Release notes"), true);
    assertEquals(readme.includes("Generated from committed Civic Ledger state."), true);
    assertEquals(readme.includes("byte sizes, and SHA-256 checksums"), true);
    assertEquals(
      readme.includes(
        "schema version, release identity, artifact file/row counts, entity/relation kind rollups, zero GovGraph-blocking review items, review posture/category/deferred-description agreement, source coverage metadata/status/count/rollup agreement, and GovGraph summary/manifest agreement",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "Add `--json` for machine-readable validity, checked file count, and error details.",
      ),
      true,
    );
    assertEquals(readme.includes("- Schema version: 1"), true);
    assertEquals(readme.includes("- Source rows in `sources.csv`: 2"), true);
    assertEquals(
      readme.includes(
        "Because `manifest.json` contains the checksum table, it is not included in its own `outputFileMetadata`",
      ),
      true,
    );
    assertEquals(readme.includes("## Scope and caveats"), true);
    assertEquals(
      readme.includes(
        "This alpha release is a reproducible checkpoint from committed state",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "Legal authority graph facts are limited to explicit D.C. Code, D.C. Law, and Mayor's Order locators",
      ),
      true,
    );
    assertEquals(readme.includes("## Source coverage"), true);
    assertEquals(readme.includes("- collected: 2"), true);
    assertEquals(readme.includes("- not_collected: 2"), true);
    assertEquals(readme.includes("- Release statuses:"), true);
    assertEquals(readme.includes("  - exported: 2"), true);
    assertEquals(readme.includes("  - inventory_only: 2"), true);
    assertEquals(readme.includes("- Source coverage families: 4"), true);
    assertEquals(readme.includes("- Family rollup:"), true);
    assertEquals(
      readme.includes(
        "  - legal_provenance: 1 row; collection not_collected: 1; release inventory_only: 1",
      ),
      true,
    );
    assertEquals(readme.includes("sourceCoverageStatusCounts"), true);
    assertEquals(readme.includes("sourceCoverageReleaseStatusCounts"), true);
    assertEquals(readme.includes("sourceCoverageFamilyRollup"), true);
    assertEquals(readme.includes("- Not-collected inventory rows:"), true);
    assertEquals(
      readme.includes(
        "  - blocked.source (blocked): Known source not present in this workspace.",
      ),
      true,
    );
    assertEquals(readme.includes("## Legal scope"), true);
    assertEquals(
      readme.includes(
        "Legal-source entries (`dc.legal_source`) are official entrypoint anchors for inspection",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "Citations may preserve evidence, URLs, or out-of-scope locators without creating legal authority entries.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "Mayor's Order authorities remain locator evidence without canonical official URLs",
      ),
      true,
    );
    assertEquals(
      readme.includes("- Deferred legal source inventory rows in `source_coverage.csv`:"),
      true,
    );
    assertEquals(
      readme.includes("  - inventory.dc_laws: D.C. laws corpus fixture."),
      true,
    );
    assertEquals(readme.includes("## Entity taxonomy"), true);
    assertEquals(
      readme.includes(
        "- Entry kinds are counts of exported ledger entries, not claims that every matching DC entity has been discovered.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "the alpha does not emit synthetic county, state, federal-branch, or city/county placeholder hierarchy without source-backed entries.",
      ),
      true,
    );
    assertEquals(
      readme.includes("- dc.agency: 1 - District agency or agency-like organization entries."),
      true,
    );
    assertEquals(
      readme.includes("- dc.smd: 1 - Single Member District area entries."),
      true,
    );
    assertEquals(readme.includes("## Relationship evidence"), true);
    assertEquals(readme.includes("- dc.relation:governs: 2"), true);
    assertEquals(
      readme.includes(
        "- dc.relation:governs: 2 - Source names a governing or administering agency for a public body; projection labels safe agency/office targets as administered_by.",
      ),
      true,
    );
    assertEquals(readme.includes("- Relation examples:"), true);
    assertEquals(
      readme.includes(
        "  - dc.relation:contains: ANC 8F (dc.anc:8F) -> SMD 8F01 (dc.smd:8F01) (source: registry:smd-8F01)",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "  - dc.relation:governs: Ethics Authority (dc.authority:au-1) -> District Agency (dc.agency:a-1) (source: gazette:rel-au-1)",
      ),
      true,
    );
    assertEquals(readme.includes("- Contract-facing relationship terms:"), true);
    assertEquals(
      readme.includes(
        "  - elected / office holder: `dc.relation:holds` links people to sourced elected-office entries",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "alpha does not infer `advises`, `appoints`, `oversees`, `administers`, or `enforces` edges",
      ),
      true,
    );
    assertEquals(readme.includes("## Public projection"), true);
    assertEquals(readme.includes("- Projected nodes: 9"), true);
    assertEquals(readme.includes("- Projected node categories:"), true);
    assertEquals(readme.includes("  - neighborhood: 3"), true);
    assertEquals(readme.includes("  - public_body: 3"), true);
    assertEquals(readme.includes("- Projected edges: 7"), true);
    assertEquals(readme.includes("- Excluded projection nodes: 0"), true);
    assertEquals(readme.includes("- Excluded projection edges: 1"), true);
    assertEquals(readme.includes("- Projected relation labels remapped for public use: 2"), true);
    assertEquals(readme.includes("- Remapped relation labels:"), true);
    assertEquals(
      readme.includes("  - dc.relation:governs -> administered_by: 2"),
      true,
    );
    assertEquals(
      readme.includes(
        "Unsupported or stale relation verbs remain reviewable in raw ledger artifacts but are excluded from GovGraph edges",
      ),
      true,
    );
    assertEquals(readme.includes("- Projected edge verbs:"), true);
    assertEquals(readme.includes("  - administered_by: 2"), true);
    assertEquals(readme.includes("  - affiliated_with: 1"), true);
    assertEquals(
      readme.includes(
        "node kind/category counts, edge verb counts, mapped relation label counts",
      ),
      true,
    );
    assertEquals(readme.includes("## Review posture"), true);
    assertEquals(readme.includes("review summaries under `reviewQueueCounts`"), true);
    assertEquals(readme.includes("descriptions for each deferred group"), true);
    assertEquals(readme.includes("- Review items: 2"), true);
    assertEquals(readme.includes("- applied: 1"), true);
    assertEquals(readme.includes("- deferred: 1"), true);
    assertEquals(readme.includes("- Review queue notes:"), true);
    assertEquals(
      readme.includes(
        "  - applied: A tracked revision or imported review decision already accounts for the item and is retained as audit evidence.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "  - deferred: Parked, non-blocking work outside current alpha scope or without public-output impact.",
      ),
      true,
    );
    assertEquals(readme.includes("- Review categories:"), true);
    assertEquals(readme.includes("  - source_shadow: 1"), true);
    assertEquals(readme.includes("  - source_stale_or_failed: 1"), true);
    assertEquals(readme.includes("- Review category notes:"), true);
    assertEquals(
      readme.includes(
        "  - source_shadow: One source appears to shadow another civic body, so curation preserves or suppresses deliberately.",
      ),
      true,
    );
    assertEquals(
      readme.includes(
        "  - source_stale_or_failed: A stale or failed source fragment is treated as an ingestion bug, not a release blocker.",
      ),
      true,
    );
    assertEquals(readme.includes("- Deferred review groups:"), true);
    assertEquals(
      readme.includes(
        "  - source_stale_or_failed / dc.interpreter.opendc_stale_or_failed_duplicate: 1",
      ),
      true,
    );
    assertEquals(readme.includes("- Deferred review group notes:"), true);
    assertEquals(
      readme.includes(
        "A stale or failed Open DC duplicate fragment was suppressed as a source ingestion bug",
      ),
      true,
    );
    assertEquals(readme.includes("reviewDeferredGroups"), true);
    assertEquals(
      readme.includes("- Release-blocking review items in GovGraph projection: 0"),
      true,
    );
    assertEquals(
      readme.includes(
        "Catalog confidence is confidence in the source-inventory row and access path",
      ),
      true,
    );
    assertEquals(readme.includes("## Artifacts"), true);
    assertEquals(
      readme.includes(
        "- `source_coverage.csv` - source inventory publisher/access metadata, catalog confidence, collection/release status, scope, contribution, exclusions, and caveats.",
      ),
      true,
    );
    assertEquals(readme.includes("publisher, access method, source URL, catalog confidence"), true);
    assertEquals(readme.includes("counts.sourceCoverageStatuses"), true);
    assertEquals(readme.includes("counts.sourceCoverageReleaseStatuses"), true);
    assertEquals(readme.includes("- `dc_anc_smd_structure.csv`"), true);
    assertEquals(readme.includes("- `dc_council_committee_membership.csv`"), true);
    assertEquals(
      readme.includes("- `README.md` - human-readable release summary and caveat trail."),
      true,
    );
    assertEquals(
      readme.includes("- `govgraph_nodes.json` - downstream-friendly public node projection."),
      true,
    );
    assertEquals(
      readme.includes(
        "- `govgraph_summary.json` - projection counts, node kind/category counts, edge verbs, mapped relation label counts, excluded nodes/edges, and blocking review counts.",
      ),
      true,
    );
    assertEquals(readme.includes("- `ledger.sqlite`"), true);
    assertEquals(
      readme.includes(
        "- `manifest.json` - machine-readable release manifest; it describes the manifest-managed outputs but is not included in its own checksum table.",
      ),
      true,
    );

    const entriesRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "entries.csv")));
    const entriesById = new Map(entriesRows.slice(1).map((row) => [row[0], row]));
    assertEquals(entriesById.get("dc.board:b-1")?.[2], "dc.board");
    assertEquals(entriesById.get("dc.authority:au-1")?.[3], "Ethics Authority");

    const relationRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "relations.csv")));
    assertEquals(relationRows.length, 9);
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

    const sourceRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "sources.csv")));
    assertEquals(sourceRows[1][0], "gazette");
    assertEquals(sourceRows[2][0], "registry");

    const sourceCoverageRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "source_coverage.csv")),
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

    const citationRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "citations.csv")));
    assertEquals(citationRows.length, 12);
    assertEquals(citationRows[1][0], "entry");
    assertEquals(citationRows[1][1], "dc.agency:a-1");
    assertEquals(citationRows[2][6], "true");

    const boardAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_board_affiliations.csv")),
    );
    assertEquals(boardAffiliations[1][0], "dc.board:b-1");
    assertEquals(boardAffiliations[1][3], "dc.agency:a-1");

    const commissionAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_commission_affiliations.csv")),
    );
    assertEquals(commissionAffiliations[1][0], "dc.commission:c-1");

    const authorityAffiliations = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_authority_affiliations.csv")),
    );
    assertEquals(authorityAffiliations[1][0], "dc.authority:au-1");

    const ancSmdStructure = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_anc_smd_structure.csv")),
    );
    assertEquals(ancSmdStructure[1][0], "dc.anc:8F");
    assertEquals(ancSmdStructure[1][3], "dc.smd:8F01");
    assertEquals(ancSmdStructure[1][5], "dc.anc_commissioner_seat:8F01");
    assertEquals(ancSmdStructure[1][7], "Nic Wilson");

    const councilCommitteeMembership = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "dc_council_committee_membership.csv")),
    );
    assertEquals(councilCommitteeMembership[1][0], "dc.committee:transportation");
    assertEquals(councilCommitteeMembership[1][3], "dc.councilmember:jane-doe");
    assertEquals(councilCommitteeMembership[1][5], "chair");

    const govGraphNodes = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_nodes.json")),
    ) as Array<Record<string, unknown>>;
    assertEquals(govGraphNodes.length, 9);
    assertEquals(govGraphNodes[0].publicStatus, "published");

    const govGraphEdges = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_edges.json")),
    ) as Array<Record<string, unknown>>;
    assertEquals(govGraphEdges.length, 7);
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
      "dc.smd": 1,
    });
    assertEquals(govGraphSummary.nodeCategoryCounts, {
      executive: 1,
      legislative: 1,
      neighborhood: 3,
      public_body: 3,
      representation: 1,
    });
    assertEquals(govGraphSummary.edgeVerbCounts, {
      administered_by: 2,
      affiliated_with: 1,
      chairs: 1,
      contains: 1,
      member_of: 1,
      represents: 1,
    });
    assertEquals(govGraphSummary.excludedNodeCount, 0);
    assertEquals(govGraphSummary.excludedEdgeCount, 1);
    assertEquals(govGraphSummary.mappedRelationCount, 2);
    assertEquals(govGraphSummary.mappedRelationCounts, [{
      relationKind: "dc.relation:governs",
      verb: "administered_by",
      count: 2,
    }]);

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
          "govgraph_summary.json.nodeCount 9 does not match govgraph_summary.json.nodeKindCounts total 0",
        )
      ),
      true,
    );
    assertEquals(
      staleGovGraphRollupVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.edgeCount 7 does not match govgraph_summary.json.edgeVerbCounts total 0",
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
          "govgraph_summary.json.nodeCount 8 does not match govgraph_nodes.json array length 9",
        )
      ),
      true,
    );
    assertEquals(
      staleGovGraphPayloadCountVerification.errors.some((error) =>
        error.includes(
          "govgraph_summary.json.edgeCount 6 does not match govgraph_edges.json array length 7",
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
      assertEquals(countRows(ledgerDb, "entries"), 9);
      assertEquals(countRows(ledgerDb, "relations"), 8);
      assertEquals(countRows(ledgerDb, "citations"), 11);
      assertEquals(countRows(ledgerDb, "sources"), 2);
      assertEquals(countRows(ledgerDb, "source_coverage"), 4);
      assertEquals(countRows(ledgerDb, "dc_anc_smd_structure"), 1);
      assertEquals(countRows(ledgerDb, "dc_council_committee_membership"), 1);
    } finally {
      ledgerDb.close();
    }

    await Deno.writeTextFile(join(releaseRoot, "entries.csv"), "tampered\n");
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
        "- dc.authority: 0 - Authority source is collected-empty in this release; see source_coverage.csv for the live-source caveat.",
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

    const citationsRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "citations.csv")));
    assertEquals(citationsRows.length, 1);
    assertEquals(citationsRows[0][0], "citation_type");

    const sourceRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "sources.csv")));
    assertEquals(sourceRows.length, 2);
    assertEquals(sourceRows[1][0], "registry");
    assertEquals(sourceRows[1][2], "0");

    const sourceCoverageRows = parseCsvRows(
      await Deno.readTextFile(join(releaseRoot, "source_coverage.csv")),
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
      assertEquals(countRows(ledgerDb, "citations"), 0);
      assertEquals(countRows(ledgerDb, "sources"), 1);
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
