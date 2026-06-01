import { Database } from "jsr:@db/sqlite";
import {
  type ConnectorResult,
  type EntitySearchResult,
  type EntityView,
  type ResolutionEventInput,
  type ReviewItemRecord,
  type SourceEndpointDefinition,
  type WorkbenchMeta,
} from "./domain.ts";
import {
  listSources as listSourceRows,
  type SourceSummary,
  sourceSummary as readSourceSummary,
  upsertEndpoint as writeEndpointRecord,
  upsertSource as writeSourceRecord,
} from "./workbench/catalog.ts";
import {
  appendResolutionEvent as appendResolutionRecord,
  applyResolutionEvent as applyResolutionRecord,
  replayResolutionDirectory as replayResolutionLog,
} from "./workbench/resolution.ts";
import { initWorkbench, readWorkbenchMeta } from "./workbench/schema.ts";
import { importConnectorResult as importConnectorIntoWorkbench } from "./workbench/import.ts";
import {
  listReviewItems as readReviewQueue,
  nextReviewItem as peekNextReviewItem,
} from "./workbench/review.ts";
import {
  artifactHashes as readArtifactHashes,
  canonicalEntities as readCanonicalEntities,
  canonicalRelationships as readCanonicalRelationships,
  datasets as readDatasets,
  entityView as readEntityView,
  legalRefs as readLegalRefs,
  searchEntities as findEntities,
  sourceInventory as readSourceInventory,
} from "./workbench/entity.ts";
import type { WorkbenchStore } from "./workbench/store.ts";

export class Workbench implements WorkbenchStore {
  readonly db: Database;

  constructor(readonly dbPath: string) {
    this.db = new Database(dbPath);
  }

  close(): void {
    this.db.close();
  }

  init(): WorkbenchMeta {
    return initWorkbench(this);
  }

  meta(): WorkbenchMeta {
    return readWorkbenchMeta(this);
  }

  async importConnectorResult(result: ConnectorResult, dataDir: string): Promise<void> {
    await importConnectorIntoWorkbench(this, result, dataDir);
  }

  upsertSource(
    sourceId: string,
    title: string,
    kind: string,
    accessMethod: string,
    baseUrl: string,
    notes?: string,
  ): void {
    writeSourceRecord(this, sourceId, title, kind, accessMethod, baseUrl, notes);
  }

  upsertEndpoint(endpoint: SourceEndpointDefinition): void {
    writeEndpointRecord(this, endpoint);
  }

  sourceSummary(sourceId: string): SourceSummary {
    return readSourceSummary(this, sourceId);
  }

  listSources(): ReturnType<typeof listSourceRows> {
    return listSourceRows(this);
  }

  listReviewItems(mode?: string): ReviewItemRecord[] {
    return readReviewQueue(this, mode);
  }

  nextReviewItem(mode?: string): ReviewItemRecord | undefined {
    return peekNextReviewItem(this, mode);
  }

  async appendResolutionEvent(
    event: ResolutionEventInput,
    resolutionsDir: string,
  ): Promise<{ filePath: string; sequenceNumber: number }> {
    return await appendResolutionRecord(this, event, resolutionsDir);
  }

  applyResolutionEvent(
    event: ResolutionEventInput,
    resolutionFile: string,
    sequenceNumber: number,
  ): void {
    applyResolutionRecord(this, event, resolutionFile, sequenceNumber);
  }

  async replayResolutionDirectory(resolutionsDir: string): Promise<void> {
    await replayResolutionLog(this, resolutionsDir);
  }

  searchEntities(query: string): EntitySearchResult[] {
    return findEntities(this, query);
  }

  entityView(entityId: string): EntityView {
    return readEntityView(this, entityId);
  }

  canonicalEntities(): ReturnType<typeof readCanonicalEntities> {
    return readCanonicalEntities(this);
  }

  canonicalRelationships(): ReturnType<typeof readCanonicalRelationships> {
    return readCanonicalRelationships(this);
  }

  sourceInventory(): ReturnType<typeof readSourceInventory> {
    return readSourceInventory(this);
  }

  datasets(): ReturnType<typeof readDatasets> {
    return readDatasets(this);
  }

  legalRefs(): ReturnType<typeof readLegalRefs> {
    return readLegalRefs(this);
  }

  artifactHashes(): ReturnType<typeof readArtifactHashes> {
    return readArtifactHashes(this);
  }
}
