import type { Database } from "@db/sqlite";

export interface WorkbenchStore {
  db: Database;
  dbPath: string;
}
