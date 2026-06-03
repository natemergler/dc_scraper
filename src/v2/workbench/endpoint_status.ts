import { buildEntityId } from "../domain.ts";
import { queryAll, queryOne } from "./db.ts";
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
  const legalStatus = legalEndpointStatus(store, entityId);
  if (legalStatus) return legalStatus;
  const statuses = queryAll<CandidateEndpointStatusRow>(
    store.db,
    `select source_items.source_id as sourceId,
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
     where entity_candidates.proposed_entity_id = ?
     order by source_runs.started_at desc,
              entity_candidates.candidate_id desc`,
    [entityId],
  );
  const currentStatuses = latestSourceItemStatuses(statuses);
  if (
    currentStatuses.some((row) => row.reviewStatus === "pending" && row.stalePriorDecision === 1)
  ) {
    return { entityId, state: "stale_candidate" };
  }
  if (
    currentStatuses.some((row) => row.reviewStatus === "pending" && row.replayConflict === 1)
  ) {
    return { entityId, state: "replay_conflict" };
  }
  if (
    currentStatuses.some((row) =>
      row.reviewStatus === "pending" && row.reviewItemStatus === "deferred"
    )
  ) {
    return { entityId, state: "deferred_candidate" };
  }
  const canonical = queryOne<CanonicalEndpointRow>(
    store.db,
    "select name, is_placeholder as isPlaceholder from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (canonical) {
    return {
      entityId,
      state: canonical.isPlaceholder === 1 ? "placeholder" : "accepted",
      name: canonical.name,
    };
  }
  if (currentStatuses.some((row) => row.reviewStatus === "pending")) {
    return { entityId, state: "pending_candidate" };
  }
  if (
    currentStatuses.length > 0 &&
    currentStatuses.every((row) => row.reviewStatus === "rejected")
  ) {
    return { entityId, state: "rejected_candidate" };
  }
  return { entityId, state: "missing" };
}

function legalEndpointStatus(
  store: Pick<WorkbenchStore, "db">,
  entityId: string,
): EndpointStatus | undefined {
  if (!entityId.startsWith("legal.")) return undefined;
  const statuses = queryAll<LegalEndpointStatusRow>(
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
  ).filter((row) =>
    buildEntityId(row.normalizedCitation ?? row.citationText, "legal") === entityId
  );
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
