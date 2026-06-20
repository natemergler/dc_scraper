import { Database } from "@db/sqlite";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { closeWorkspace, initWorkspace, openWorkspace } from "../../src/workspace/workspace.ts";
import { exportReleaseArtifacts } from "../../src/export/export.ts";

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
          scope: "Gazette fixture scope.",
          contributes: "Entry citations.",
          excludes: "Contacts.",
        },
        {
          source: "registry",
          sourceType: "fixture.registry",
          family: "registry",
          scope: "Registry fixture scope.",
          contributes: "Entries and relation citations.",
          excludes: "Unreviewed duplicates.",
        },
        {
          source: "blocked.source",
          sourceType: "fixture.blocked",
          family: "blocked",
          scope: "Known source not present in this workspace.",
          contributes: "No current state entries.",
          excludes: "Live-only records.",
          notes: "Fixture for not_collected coverage rows.",
        },
      ],
    });

    assertEquals(result.entryCount, 9);
    assertEquals(result.relationCount, 8);
    assertEquals(result.citationCount, 11);
    assertEquals(result.sourceCount, 2);
    assertEquals(result.sourceCoverageCount, 3);
    assertEquals(result.boardAffiliationCount, 1);
    assertEquals(result.commissionAffiliationCount, 1);
    assertEquals(result.authorityAffiliationCount, 1);
    assertEquals(result.ancSmdStructureCount, 1);
    assertEquals(result.councilCommitteeMembershipCount, 1);
    assertEquals(result.govGraphNodeCount, 9);
    assertEquals(result.govGraphEdgeCount, 8);

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
    assertEquals((manifest.counts as Record<string, unknown>).entries, 9);
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
    assertEquals((manifest.counts as Record<string, unknown>).sourceCoverage, 3);
    assertEquals((manifest.counts as Record<string, unknown>).ancSmdStructure, 1);
    assertEquals((manifest.counts as Record<string, unknown>).councilCommitteeMembership, 1);
    assertEquals((manifest.counts as Record<string, unknown>).govGraphNodes, 9);
    assertEquals((manifest.counts as Record<string, unknown>).govGraphEdges, 8);
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
    for (const outputPath of Object.values(manifestOutputs)) {
      assertEquals(await exists(join(releaseRoot, outputPath)), true);
    }

    const readme = await Deno.readTextFile(join(releaseRoot, "README.md"));
    assertEquals(readme.includes("## Release notes"), true);
    assertEquals(readme.includes("Generated from committed Civic Ledger state."), true);
    assertEquals(readme.includes("## Artifacts"), true);
    assertEquals(readme.includes("- `source_coverage.csv`"), true);
    assertEquals(readme.includes("- `dc_anc_smd_structure.csv`"), true);
    assertEquals(readme.includes("- `dc_council_committee_membership.csv`"), true);
    assertEquals(readme.includes("- `ledger.sqlite`"), true);

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
      "collection_status",
      "snapshot_count",
      "record_count",
      "citation_count",
      "scope",
      "contributes",
      "excludes",
      "notes",
    ]);
    const sourceCoverageBySource = new Map(sourceCoverageRows.slice(1).map((row) => [row[0], row]));
    assertEquals(sourceCoverageBySource.get("blocked.source")?.[3], "not_collected");
    assertEquals(sourceCoverageBySource.get("gazette")?.[3], "collected_empty");
    assertEquals(sourceCoverageBySource.get("registry")?.[6], "7");

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
    assertEquals(govGraphEdges.length, 8);
    assertEquals(
      govGraphEdges.some((edge) =>
        edge.relationKind === "dc.relation:governs" && edge.verb === "administered_by"
      ),
      true,
    );

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      assertEquals(countRows(ledgerDb, "entries"), 9);
      assertEquals(countRows(ledgerDb, "relations"), 8);
      assertEquals(countRows(ledgerDb, "citations"), 11);
      assertEquals(countRows(ledgerDb, "sources"), 2);
      assertEquals(countRows(ledgerDb, "source_coverage"), 3);
      assertEquals(countRows(ledgerDb, "dc_anc_smd_structure"), 1);
      assertEquals(countRows(ledgerDb, "dc_council_committee_membership"), 1);
    } finally {
      ledgerDb.close();
    }
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
    assertEquals(sourceCoverageRows[1][3], "collected_empty");

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
