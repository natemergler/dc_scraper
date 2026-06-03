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
import { autoAcceptSafeLegalRefs } from "./workbench/auto_accept_legal_refs.ts";
import { autoAcceptSafeRelationshipCandidates } from "./workbench/auto_accept_relationships.ts";
import { autoPromoteSafeEntityCandidates } from "./workbench/auto_promote.ts";
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
  reviewDebtSummary as readReviewDebtSummary,
  type ReviewItemFilters,
  staleReviewSummary as readStaleReviewSummary,
} from "./workbench/review.ts";
import {
  canonicalEntities as readCanonicalEntities,
  canonicalRelationships as readCanonicalRelationships,
  datasets as readDatasets,
  entityLegalRefs as readEntityLegalRefs,
  entityView as readEntityView,
  legalRefs as readLegalRefs,
  placeholderSummary as readPlaceholderSummary,
  relationshipLegalRefs as readRelationshipLegalRefs,
  searchEntities as findEntities,
  sourceArtifacts as readSourceArtifacts,
  sourceInventory as readSourceInventory,
} from "./workbench/entity.ts";
import type { WorkbenchStore } from "./workbench/store.ts";

interface WorkbenchInitOptions {
  refreshDerivedState?: boolean;
}

interface WorkbenchOpenOptions {
  readonly?: boolean;
  busyTimeoutMs?: number;
  useWal?: boolean;
}

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

export class Workbench implements WorkbenchStore {
  readonly db: Database;

  constructor(readonly dbPath: string, options: WorkbenchOpenOptions = {}) {
    if (!options.readonly) {
      Deno.mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath, { readonly: options.readonly });
    this.db.exec("pragma foreign_keys = on");
    const busyTimeoutMs = Math.max(
      0,
      Math.trunc(options.busyTimeoutMs ?? DEFAULT_SQLITE_BUSY_TIMEOUT_MS),
    );
    this.db.exec(`pragma busy_timeout = ${busyTimeoutMs}`);
    if (!options.readonly && options.useWal !== false) {
      this.db.exec("pragma journal_mode = wal");
    }
  }

  close(): void {
    this.db.close();
  }

  init(options: WorkbenchInitOptions = {}): WorkbenchMeta {
    const meta = initWorkbench(this);
    if (options.refreshDerivedState === false) return meta;
    autoAcceptSafeLegalRefs(this);
    autoPromoteSafeEntityCandidates(this);
    reconcileRelationshipCandidates(this);
    autoAcceptSafeRelationshipCandidates(this);
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

  staleReviewSummary(): ReturnType<typeof readStaleReviewSummary> {
    return readStaleReviewSummary(this);
  }

  reviewDebtSummary(): ReturnType<typeof readReviewDebtSummary> {
    return readReviewDebtSummary(this);
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

  relationshipLegalRefs(): ReturnType<typeof readRelationshipLegalRefs> {
    return readRelationshipLegalRefs(this);
  }

  placeholderSummary(): ReturnType<typeof readPlaceholderSummary> {
    return readPlaceholderSummary(this);
  }

  sourceArtifacts(): ReturnType<typeof readSourceArtifacts> {
    return readSourceArtifacts(this);
  }

  reconciliationSummary(): ReturnType<typeof readReconciliationSummary> {
    return readReconciliationSummary(this);
  }
}
