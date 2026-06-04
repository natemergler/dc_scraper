import type { Database } from "@db/sqlite";

export function queryOne<T>(
  db: Database,
  sql: string,
  params: unknown[] = [],
): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function queryAll<T>(
  db: Database,
  sql: string,
  params: unknown[] = [],
): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function run(
  db: Database,
  sql: string,
  params: unknown[] = [],
): void {
  db.prepare(sql).run(...(params as never[]));
}

export function withTransaction<T>(db: Database, work: () => T): T {
  const savepoint = `dc_tx_${crypto.randomUUID().replaceAll("-", "_")}`;
  db.exec(`savepoint ${savepoint}`);
  try {
    const result = work();
    db.exec(`release savepoint ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`rollback to savepoint ${savepoint}`);
    db.exec(`release savepoint ${savepoint}`);
    throw error;
  }
}
