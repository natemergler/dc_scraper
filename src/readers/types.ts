export interface ReaderWorkspace {
  root: string;
}

export interface ReaderSource {
  id: string;
  jurisdiction: string;
}

export interface ReaderResultSnapshot {
  source: string;
  key: string;
  payload: Record<string, unknown>;
}

export interface ReaderResultRecord {
  source: string;
  snapshotKey: string;
  key: string;
  payload: Record<string, unknown>;
}

export interface ReaderResult {
  snapshots: ReaderResultSnapshot[];
  records: ReaderResultRecord[];
}

export interface ReaderInput<T extends ReaderSource = ReaderSource> {
  workspace: ReaderWorkspace;
  source: T;
  limit?: number;
}

export interface Reader<T extends ReaderSource = ReaderSource> {
  collect(input: ReaderInput<T>): Promise<ReaderResult>;
}
