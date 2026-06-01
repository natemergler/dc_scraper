import type { Database } from "jsr:@db/sqlite";

export interface WorkbenchStore {
  db: Database;
  dbPath: string;
}
