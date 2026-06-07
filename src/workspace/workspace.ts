import { Database } from "@db/sqlite";
import { ensureDirSync, ensureFileSync } from "@std/fs";
import { join } from "@std/path";

import { type Entry, type Finding, type LedgerState } from "../core/types.ts";
import { type ReaderResultRecord } from "../readers/types.ts";

export interface Workspace {
  root: string;
  dbPath: string;
  db: Database;
}

export interface SnapshotInput {
  source: string;
  key: string;
  payload: unknown;
}

export interface RecordInput {
  source: string;
  snapshotId: number;
  key: string;
  payload: unknown;
}

export interface FragmentInput {
  source: string;
  sourceRecordId: string;
  payload: unknown;
}

export interface BaselineInput {
  jurisdiction: string;
  source: string;
  payload: LedgerState;
}

export function openWorkspace(workspaceRoot: string): Workspace {
  ensureDirSync(workspaceRoot);
  const dbPath = join(workspaceRoot, "civic.sqlite");
  ensureFileSync(dbPath);
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  return { root: workspaceRoot, dbPath, db };
}

export interface LoadedRecord extends ReaderResultRecord {
  sourceRecordId: string;
  snapshotKey: string;
}

export function closeWorkspace(workspace: Workspace): void {
  workspace.db.close();
}

export function resetWorkspace(workspace: Workspace): void {
  workspace.db.run("DELETE FROM state_entries");
  workspace.db.run("DELETE FROM state_relations");
  workspace.db.run("DELETE FROM baselines");
  workspace.db.run("DELETE FROM findings");
  workspace.db.run("DELETE FROM fragments");
  workspace.db.run("DELETE FROM records");
  workspace.db.run("DELETE FROM snapshots");
  workspace.db.run("DELETE FROM meta");
}

export function loadRecords(workspace: Workspace, source?: string): LoadedRecord[] {
  const statement = source
    ? workspace.db.prepare(
      "SELECT r.source AS source, s.snapshot_key AS snapshot_key, r.record_key, r.payload FROM records AS r INNER JOIN snapshots AS s ON s.id = r.snapshot_id WHERE r.source = ? ORDER BY r.id ASC",
    )
    : workspace.db.prepare(
      "SELECT r.source AS source, s.snapshot_key AS snapshot_key, r.record_key, r.payload FROM records AS r INNER JOIN snapshots AS s ON s.id = r.snapshot_id ORDER BY r.id ASC",
    );

  const rows = source ? statement.all([source]) : statement.all();
  return rows
    .map((row) => {
      const payload = row.payload as string;
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== "object") {
        throw new Error(`record payload for ${row.record_key} is not an object`);
      }

      return {
        source: row.source as string,
        snapshotKey: row.snapshot_key as string,
        key: row.record_key as string,
        payload: parsed as Record<string, unknown>,
      };
    }) as LoadedRecord[];
}

export function initWorkspace(workspace: Workspace): void {
  const { db } = workspace;

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, snapshot_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      record_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(snapshot_id, record_key),
      FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jurisdiction TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS state_entries (
      entry_id TEXT PRIMARY KEY,
      jurisdiction TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS state_relations (
      from_entry_id TEXT NOT NULL,
      relation_kind TEXT NOT NULL,
      to_entry_id TEXT NOT NULL,
      citations TEXT,
      PRIMARY KEY (from_entry_id, relation_kind, to_entry_id)
    )
  `);
}

export function saveSnapshot(workspace: Workspace, snapshot: SnapshotInput): number {
  const payload = JSON.stringify(snapshot.payload);
  workspace.db.run(
    `INSERT INTO snapshots (source, snapshot_key, payload)
     VALUES (?, ?, ?)
     ON CONFLICT(source, snapshot_key) DO UPDATE SET payload = excluded.payload,
       created_at = datetime('now')`,
    [snapshot.source, snapshot.key, payload],
  );

  const row = workspace.db.prepare(
    "SELECT id FROM snapshots WHERE source = ? AND snapshot_key = ?",
  ).get([snapshot.source, snapshot.key]) as { id: number };
  if (!row) {
    throw new Error("snapshot was not persisted");
  }

  return row.id;
}

export function saveRecords(workspace: Workspace, records: RecordInput[]): void {
  for (const record of records) {
    const payload = JSON.stringify(record.payload);
    workspace.db.run(
      `INSERT INTO records (snapshot_id, source, record_key, payload)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(snapshot_id, record_key) DO UPDATE SET
         source = excluded.source,
         payload = excluded.payload,
         created_at = datetime('now')`,
      [record.snapshotId, record.source, record.key, payload],
    );
  }
}

export function saveFragments(workspace: Workspace, fragments: FragmentInput[]): void {
  for (const fragment of fragments) {
    const payload = JSON.stringify(fragment.payload);
    workspace.db.run(
      `INSERT INTO fragments (source, source_record_id, payload)
       VALUES (?, ?, ?)`,
      [fragment.source, fragment.sourceRecordId, payload],
    );
  }
}

export function saveBaseline(workspace: Workspace, baseline: BaselineInput): void {
  const payload = JSON.stringify({
    jurisdiction: baseline.jurisdiction,
    generatedAt: baseline.payload.generatedAt,
    entries: Object.fromEntries(baseline.payload.entries),
  });
  workspace.db.run(
    `INSERT INTO baselines (jurisdiction, source, payload)
     VALUES (?, ?, ?)`,
    [baseline.jurisdiction, baseline.source, payload],
  );
}

export function saveFinding(workspace: Workspace, finding: Finding): void {
  workspace.db.run("INSERT INTO findings (source, payload) VALUES (?, ?)", [
    finding.code,
    JSON.stringify(finding),
  ]);
}

export function indexState(workspace: Workspace, state: LedgerState): void {
  const jurisdiction = state.jurisdiction || "unknown";
  workspace.db.run("DELETE FROM state_entries");
  workspace.db.run("DELETE FROM state_relations");
  for (const entry of state.entries.values()) {
    workspace.db.run(
      `INSERT INTO state_entries (entry_id, jurisdiction, kind, payload)
       VALUES (?, ?, ?, ?)`,
      [entry.id, jurisdiction, entry.kind, JSON.stringify(entry)],
    );

    for (const relations of Object.values(entry.relations ?? {})) {
      for (const relation of relations) {
        workspace.db.run(
          `INSERT INTO state_relations (from_entry_id, relation_kind, to_entry_id, citations)
           VALUES (?, ?, ?, ?)`,
          [
            entry.id,
            relation.kind,
            relation.to,
            JSON.stringify(relation.citations ?? []),
          ],
        );
      }
    }
  }
}
