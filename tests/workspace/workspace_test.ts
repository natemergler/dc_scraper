import { assertEquals } from "@std/assert";

import {
  closeWorkspace,
  indexState,
  initWorkspace,
  openWorkspace,
  saveBaseline,
  saveFinding,
  saveFragments,
  saveRecords,
  saveSnapshot,
} from "../../src/workspace/workspace.ts";
import { cite, type Entry, type LedgerState } from "../../src/core/types.ts";

Deno.test("openWorkspace + initWorkspace creates workspace schema", () => {
  const workspaceRoot = joinTempDir();
  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  const foreignKeys = workspace.db.prepare("PRAGMA foreign_keys").get() as
    | { foreign_keys: number }
    | undefined;
  assertEquals(foreignKeys?.foreign_keys, 1);

  const schemaRows = workspace.db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all();
  const tables = new Set<string>();
  for (const row of schemaRows) {
    tables.add((row as { name: string }).name);
  }

  closeWorkspace(workspace);
  Deno.removeSync(workspaceRoot, { recursive: true });

  const requiredTables = [
    "meta",
    "snapshots",
    "records",
    "fragments",
    "baselines",
    "findings",
    "state_entries",
    "state_relations",
  ];
  for (const required of requiredTables) {
    assertEquals(tables.has(required), true);
  }
});

Deno.test("saveSnapshot/saveRecords/saveFragments/saveFinding insert rows", () => {
  const workspaceRoot = joinTempDir();
  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  const snapshotId = saveSnapshot(workspace, {
    source: "dcgis.agencies",
    key: "snapshot-1",
    payload: {
      page: 1,
      total: 2,
      data: [{ id: "row-1" }, { id: "row-2" }],
    },
  });

  saveRecords(workspace, [{
    source: "dcgis.agencies",
    snapshotId,
    key: "row-1",
    payload: { id: "dc-agency-1", name: "Transportation" },
  }]);

  saveFragments(workspace, [{
    source: "dcgis.agencies",
    sourceRecordId: "row-1",
    payload: { provisionalId: "p-1", kind: "entry_fragment" },
  }]);

  saveFinding(workspace, {
    kind: "warn",
    code: "test.finding",
    message: "a sample finding",
  });

  assertEquals(countRows(workspace, "snapshots"), 1);
  assertEquals(countRows(workspace, "records"), 1);
  assertEquals(countRows(workspace, "fragments"), 1);
  assertEquals(countRows(workspace, "findings"), 1);

  closeWorkspace(workspace);
  Deno.removeSync(workspaceRoot, { recursive: true });
});

Deno.test("saveBaseline stores source-grounded baseline row", () => {
  const workspaceRoot = joinTempDir();
  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  saveBaseline(workspace, {
    jurisdiction: "dc",
    source: "dcgis.agencies",
    payload: {
      jurisdiction: "dc",
      generatedAt: "2026-06-07T00:00:00.000Z",
      entries: new Map(),
      findings: [],
    },
  });

  assertEquals(countRows(workspace, "baselines"), 1);

  closeWorkspace(workspace);
  Deno.removeSync(workspaceRoot, { recursive: true });
});

Deno.test("indexState writes index tables", () => {
  const workspaceRoot = joinTempDir();
  const workspace = openWorkspace(workspaceRoot);
  initWorkspace(workspace);

  const baselineEntries = new Map<string, Entry>();
  baselineEntries.set("dc.agency:alpha", {
    id: "dc.agency:alpha",
    family: "organization",
    kind: "dc.agency",
    name: "Alpha",
    attributes: { shortName: "Alpha" },
    citations: [cite("dcgis.agencies", "row-1")],
    relations: {
      governs: [{
        kind: "dc.relation:oversees",
        to: "dc.agency:alpha",
        citations: [cite("dcgis.agencies", "row-1")],
      }],
    },
  });

  const state: LedgerState = {
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    entries: baselineEntries,
    findings: [],
  };

  indexState(workspace, state);

  assertEquals(countRows(workspace, "state_entries"), 1);
  assertEquals(countRows(workspace, "state_relations"), 1);
  const relationRow = workspace.db.prepare(
    "SELECT relation_kind FROM state_relations",
  ).get() as { relation_kind: string } | undefined;
  assertEquals(relationRow?.relation_kind, "dc.relation:oversees");

  closeWorkspace(workspace);
  Deno.removeSync(workspaceRoot, { recursive: true });
});

function joinTempDir(): string {
  return "/tmp/civic-ledger-workspace-" + crypto.randomUUID();
}

function countRows(workspace: Parameters<typeof initWorkspace>[0], table: string): number {
  const statement = workspace.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`);
  const row = statement.get() as { count: number } | undefined;
  return row?.count ?? 0;
}
