import { Database } from "@db/sqlite";
import { dirname } from "@std/path";
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
  comparePublicBodies as readPublicBodyComparison,
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
  reconcileRelationshipCandidates,
  reconciliationSummary as readReconciliationSummary,
} from "./workbench/reconciliation.ts";
import {
  listReviewItems as readReviewQueue,
  nextReviewItem as peekNextReviewItem,
  type ReviewItemFilters,
} from "./workbench/review.ts";
import {
  canonicalEntities as readCanonicalEntities,
  canonicalRelationships as readCanonicalRelationships,
  datasets as readDatasets,
  entityLegalRefs as readEntityLegalRefs,
  entityView as readEntityView,
  legalRefs as readLegalRefs,
  searchEntities as findEntities,
  sourceArtifacts as readSourceArtifacts,
  sourceInventory as readSourceInventory,
} from "./workbench/entity.ts";
import type { WorkbenchStore } from "./workbench/store.ts";

export class Workbench implements WorkbenchStore {
  readonly db: Database;

  constructor(readonly dbPath: string) {
    Deno.mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("pragma foreign_keys = on");
  }

  close(): void {
    this.db.close();
  }

  init(): WorkbenchMeta {
    const meta = initWorkbench(this);
    reconcileRelationshipCandidates(this);
    return meta;
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

  comparePublicBodies(): ReturnType<typeof readPublicBodyComparison> {
    return readPublicBodyComparison(this);
  }

  listSources(): ReturnType<typeof listSourceRows> {
    return listSourceRows(this);
  }

  listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[] {
    return readReviewQueue(this, filters);
  }

  nextReviewItem(filters?: string | ReviewItemFilters): ReviewItemRecord | undefined {
    return peekNextReviewItem(this, filters);
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

  entityLegalRefs(): ReturnType<typeof readEntityLegalRefs> {
    return readEntityLegalRefs(this);
  }

  sourceArtifacts(): ReturnType<typeof readSourceArtifacts> {
    return readSourceArtifacts(this);
  }

  reconciliationSummary(): ReturnType<typeof readReconciliationSummary> {
    return readReconciliationSummary(this);
  }
}
