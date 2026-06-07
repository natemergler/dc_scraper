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

    const result = await exportReleaseArtifacts({
      workspace,
      jurisdiction: "dc",
      releaseRoot,
    });

    assertEquals(result.entryCount, 4);
    assertEquals(result.relationCount, 4);
    assertEquals(result.citationCount, 7);
    assertEquals(result.sourceCount, 2);
    assertEquals(result.boardAffiliationCount, 1);
    assertEquals(result.commissionAffiliationCount, 1);
    assertEquals(result.authorityAffiliationCount, 1);

    const expectedFiles = [
      "entries.csv",
      "relations.csv",
      "citations.csv",
      "sources.csv",
      "dc_board_affiliations.csv",
      "dc_commission_affiliations.csv",
      "dc_authority_affiliations.csv",
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
    assertEquals((manifest.counts as Record<string, unknown>).entries, 4);
    assertEquals((manifest.counts as Record<string, unknown>).relations, 4);
    assertEquals(
      (manifest.counts as Record<string, unknown>).relationKinds,
      {
        "dc.relation:affiliated_with": 1,
        "dc.relation:governs": 2,
        "dc.relation:oversees": 1,
      },
    );
    assertEquals((manifest.counts as Record<string, unknown>).citations, 7);
    assertEquals((manifest.counts as Record<string, unknown>).sources, 2);

    const entriesRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "entries.csv")));
    const entriesById = new Map(entriesRows.slice(1).map((row) => [row[0], row]));
    assertEquals(entriesById.get("dc.board:b-1")?.[2], "dc.board");
    assertEquals(entriesById.get("dc.authority:au-1")?.[3], "Ethics Authority");

    const relationRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "relations.csv")));
    assertEquals(relationRows.length, 5);
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

    const citationRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "citations.csv")));
    assertEquals(citationRows.length, 8);
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

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      assertEquals(countRows(ledgerDb, "entries"), 4);
      assertEquals(countRows(ledgerDb, "relations"), 4);
      assertEquals(countRows(ledgerDb, "citations"), 7);
      assertEquals(countRows(ledgerDb, "sources"), 2);
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
    assertEquals(result.boardAffiliationCount, 0);
    assertEquals(result.commissionAffiliationCount, 0);
    assertEquals(result.authorityAffiliationCount, 0);

    const citationsRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "citations.csv")));
    assertEquals(citationsRows.length, 1);
    assertEquals(citationsRows[0][0], "citation_type");

    const sourceRows = parseCsvRows(await Deno.readTextFile(join(releaseRoot, "sources.csv")));
    assertEquals(sourceRows.length, 2);
    assertEquals(sourceRows[1][0], "registry");
    assertEquals(sourceRows[1][2], "0");

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      assertEquals(countRows(ledgerDb, "citations"), 0);
      assertEquals(countRows(ledgerDb, "sources"), 1);
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
