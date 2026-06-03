import { buildEntityId } from "../domain.ts";
import { queryAll } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface CanonicalEndpointRow {
  name: string;
  isPlaceholder: number;
}

interface CandidateEndpointStatusRow {
  sourceId: string;
  itemKey: string;
  runStartedAt: string;
  reviewStatus: string;
  reviewItemStatus?: string | null;
  stalePriorDecision?: number | null;
  replayConflict?: number | null;
}

interface LegalEndpointStatusRow {
  legalRefId: string;
  citationText: string;
  normalizedCitation?: string | null;
  reviewStatus: string;
  reviewItemStatus?: string | null;
  stalePriorDecision?: number | null;
  replayConflict?: number | null;
}

export type EndpointState =
  | "accepted"
  | "missing"
  | "pending_candidate"
  | "deferred_candidate"
  | "placeholder"
  | "replay_conflict"
  | "stale_candidate"
  | "rejected_candidate";

export interface EndpointStatus {
  entityId: string;
  state: EndpointState;
  name?: string;
}

export function endpointStatus(
  store: Pick<WorkbenchStore, "db">,
  entityId: string,
): EndpointStatus {
  return endpointStatusMap(store, [entityId]).get(entityId) ?? { entityId, state: "missing" };
}

export function endpointStatusMap(
  store: Pick<WorkbenchStore, "db">,
  entityIds: Iterable<string>,
): Map<string, EndpointStatus> {
  const requestedIds = [...new Set(entityIds)];
  const statuses = new Map(
    requestedIds.map((entityId) => [entityId, { entityId, state: "missing" } as EndpointStatus]),
  );
  const legalEntityIds = new Set(requestedIds.filter((entityId) => entityId.startsWith("legal.")));
  if (legalEntityIds.size > 0) {
    applyLegalEndpointStatuses(store, statuses, legalEntityIds);
  }

  const nonLegalEntityIds = requestedIds.filter((entityId) => !entityId.startsWith("legal."));
  if (nonLegalEntityIds.length === 0) return statuses;

  const candidateRows = queryEndpointCandidateStatuses(store, nonLegalEntityIds);
  const candidateRowsByEntityId = groupBy(candidateRows, (row) => row.proposedEntityId);
  const canonicalRows = queryCanonicalEndpointRows(store, nonLegalEntityIds);
  const canonicalRowsByEntityId = new Map(
    canonicalRows.map((row) => [row.entityId, row]),
  );

  for (const entityId of nonLegalEntityIds) {
    const currentStatuses = latestSourceItemStatuses(candidateRowsByEntityId.get(entityId) ?? []);
    if (
      currentStatuses.some((row) => row.reviewStatus === "pending" && row.stalePriorDecision === 1)
    ) {
      statuses.set(entityId, { entityId, state: "stale_candidate" });
      continue;
    }
    if (
      currentStatuses.some((row) => row.reviewStatus === "pending" && row.replayConflict === 1)
    ) {
      statuses.set(entityId, { entityId, state: "replay_conflict" });
      continue;
    }
    if (
      currentStatuses.some((row) =>
        row.reviewStatus === "pending" && row.reviewItemStatus === "deferred"
      )
    ) {
      statuses.set(entityId, { entityId, state: "deferred_candidate" });
      continue;
    }
    const canonical = canonicalRowsByEntityId.get(entityId);
    if (canonical) {
      statuses.set(entityId, {
        entityId,
        state: canonical.isPlaceholder === 1 ? "placeholder" : "accepted",
        name: canonical.name,
      });
      continue;
    }
    if (currentStatuses.some((row) => row.reviewStatus === "pending")) {
      statuses.set(entityId, { entityId, state: "pending_candidate" });
      continue;
    }
    if (
      currentStatuses.length > 0 &&
      currentStatuses.every((row) => row.reviewStatus === "rejected")
    ) {
      statuses.set(entityId, { entityId, state: "rejected_candidate" });
    }
  }
  return statuses;
}

interface BulkCanonicalEndpointRow extends CanonicalEndpointRow {
  entityId: string;
}

interface BulkCandidateEndpointStatusRow extends CandidateEndpointStatusRow {
  proposedEntityId: string;
}

function queryEndpointCandidateStatuses(
  store: Pick<WorkbenchStore, "db">,
  entityIds: string[],
): BulkCandidateEndpointStatusRow[] {
  return queryRowsByIds<BulkCandidateEndpointStatusRow>(
    store,
    entityIds,
    (placeholders) =>
      `select entity_candidates.proposed_entity_id as proposedEntityId,
              source_items.source_id as sourceId,
              source_items.item_key as itemKey,
              source_runs.started_at as runStartedAt,
              entity_candidates.review_status as reviewStatus,
              review_items.status as reviewItemStatus,
              json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision,
              json_extract(review_items.details_json, '$.replayConflict') as replayConflict
       from entity_candidates
       join source_items on source_items.source_item_id = entity_candidates.source_item_id
       join source_runs on source_runs.run_id = source_items.run_id
       left join review_items
         on review_items.subject_id = entity_candidates.candidate_id
        and review_items.item_type = 'entity_candidate'
       where entity_candidates.proposed_entity_id in (${placeholders})
       order by source_runs.started_at desc,
                entity_candidates.candidate_id desc`,
  );
}

function queryCanonicalEndpointRows(
  store: Pick<WorkbenchStore, "db">,
  entityIds: string[],
): BulkCanonicalEndpointRow[] {
  return queryRowsByIds<BulkCanonicalEndpointRow>(
    store,
    entityIds,
    (placeholders) =>
      `select entity_id as entityId,
              name,
              is_placeholder as isPlaceholder
       from canonical_entities
       where entity_id in (${placeholders})`,
  );
}

function queryRowsByIds<T>(
  store: Pick<WorkbenchStore, "db">,
  entityIds: string[],
  sqlForPlaceholders: (placeholders: string) => string,
): T[] {
  const rows: T[] = [];
  for (const chunk of chunks(entityIds, 500)) {
    rows.push(
      ...queryAll<T>(
        store.db,
        sqlForPlaceholders(chunk.map(() => "?").join(", ")),
        chunk,
      ),
    );
  }
  return rows;
}

function applyLegalEndpointStatuses(
  store: Pick<WorkbenchStore, "db">,
  statuses: Map<string, EndpointStatus>,
  legalEntityIds: Set<string>,
): void {
  const legalRowsByEntityId = new Map<string, LegalEndpointStatusRow[]>();
  for (
    const row of queryAll<LegalEndpointStatusRow>(
      store.db,
      `select legal_refs.legal_ref_id as legalRefId,
            legal_refs.citation_text as citationText,
            legal_refs.normalized_citation as normalizedCitation,
            legal_refs.review_status as reviewStatus,
            review_items.status as reviewItemStatus,
            json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision,
            json_extract(review_items.details_json, '$.replayConflict') as replayConflict
     from legal_refs
     left join review_items
       on review_items.subject_id = legal_refs.legal_ref_id
      and review_items.item_type = 'legal_ref'
     order by legal_refs.legal_ref_id`,
    )
  ) {
    const entityId = buildEntityId(row.normalizedCitation ?? row.citationText, "legal");
    if (!legalEntityIds.has(entityId)) continue;
    const rows = legalRowsByEntityId.get(entityId) ?? [];
    rows.push(row);
    legalRowsByEntityId.set(entityId, rows);
  }
  for (const entityId of legalEntityIds) {
    statuses.set(
      entityId,
      legalEndpointStatusFromRows(entityId, legalRowsByEntityId.get(entityId) ?? []),
    );
  }
}

function legalEndpointStatusFromRows(
  entityId: string,
  statuses: LegalEndpointStatusRow[],
): EndpointStatus {
  if (statuses.length === 0) return { entityId, state: "missing" };

  const name = statuses.find((row) => row.normalizedCitation)?.normalizedCitation ??
    statuses[0]?.citationText;
  if (
    statuses.some((row) => row.reviewStatus === "pending" && row.stalePriorDecision === 1)
  ) {
    return { entityId, state: "stale_candidate", name };
  }
  if (
    statuses.some((row) => row.reviewStatus === "pending" && row.replayConflict === 1)
  ) {
    return { entityId, state: "replay_conflict", name };
  }
  if (
    statuses.some((row) => row.reviewStatus === "pending" && row.reviewItemStatus === "deferred")
  ) {
    return { entityId, state: "deferred_candidate", name };
  }
  if (statuses.some((row) => row.reviewStatus === "accepted")) {
    return { entityId, state: "accepted", name };
  }
  if (statuses.some((row) => row.reviewStatus === "pending")) {
    return { entityId, state: "pending_candidate", name };
  }
  if (statuses.some((row) => row.reviewStatus === "rejected")) {
    return { entityId, state: "rejected_candidate", name };
  }
  return { entityId, state: "missing", name };
}

function latestSourceItemStatuses(
  statuses: CandidateEndpointStatusRow[],
): CandidateEndpointStatusRow[] {
  const latestBySourceItem = new Map<string, string>();
  for (const status of statuses) {
    const sourceItemKey = `${status.sourceId}\u0000${status.itemKey}`;
    const priorStartedAt = latestBySourceItem.get(sourceItemKey);
    if (!priorStartedAt || status.runStartedAt > priorStartedAt) {
      latestBySourceItem.set(sourceItemKey, status.runStartedAt);
    }
  }
  return statuses.filter((status) => {
    const sourceItemKey = `${status.sourceId}\u0000${status.itemKey}`;
    return latestBySourceItem.get(sourceItemKey) === status.runStartedAt;
  });
}

function groupBy<T, K>(rows: T[], keyForRow: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyForRow(row);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
