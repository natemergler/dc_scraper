import type { ReviewItemType, ReviewStatus } from "../domain.ts";
import { queryAll } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

export interface UnresolvedDecisionNode {
  nodeId: string;
  reviewItemId: string;
  itemType: ReviewItemType;
  subjectId: string;
  sourceId: string;
  reason: string;
  defaultAction: string;
  status: ReviewStatus;
  details: Record<string, unknown>;
  downstreamBlockedCount: number;
  blockedSubjectIds: string[];
}

export interface UnresolvedDiagnosticNode {
  nodeId: string;
  subjectType: string;
  subjectId: string;
  sourceId: string;
  state: "blocked";
  reason: string;
  relationshipType?: string;
  rawValue?: string | null;
  blockers: UnresolvedDiagnosticBlocker[];
}

export interface UnresolvedDiagnosticBlocker {
  blockerId: string;
  blockerType: string;
  blockerState: string;
  blockerLabel: string;
  hasActionablePrerequisite: boolean;
  actionableDecisionIds: string[];
}

export interface UnresolvedWorkEdge {
  kind: "unblocks";
  fromNodeId: string;
  toNodeId: string;
  blockerId: string;
}

export interface UnresolvedWorkGraph {
  decisions: UnresolvedDecisionNode[];
  diagnostics: UnresolvedDiagnosticNode[];
  edges: UnresolvedWorkEdge[];
}

interface DecisionRow {
  reviewItemId: string;
  itemType: ReviewItemType;
  subjectId: string;
  sourceId?: string | null;
  reason: string;
  defaultAction: string;
  status: ReviewStatus;
  detailsJson: string;
}

interface DiagnosticRow {
  subjectType: string;
  subjectId: string;
  sourceId: string;
  state: "blocked";
  reason: string;
  relationshipType?: string | null;
  rawValue?: string | null;
}

interface BlockerRow {
  subjectType: string;
  subjectId: string;
  blockerId: string;
  blockerType: string;
  blockerState: string;
  blockerLabel: string;
}

export function buildUnresolvedWorkGraph(
  store: Pick<WorkbenchStore, "db">,
): UnresolvedWorkGraph {
  const decisions = readDecisionNodes(store);
  const diagnostics = readDiagnosticNodes(store);
  const decisionsByEndpoint = decisionsByProposedEndpoint(store, decisions);
  const diagnosticNodesBySubject = new Map(diagnostics.map((diagnostic) => [
    diagnosticSubjectKey(diagnostic.subjectType, diagnostic.subjectId),
    diagnostic,
  ]));
  const blockedSubjectsByDecision = new Map<string, Set<string>>();
  const edges: UnresolvedWorkEdge[] = [];

  for (const blocker of readBlockers(store)) {
    const diagnostic = diagnosticNodesBySubject.get(
      diagnosticSubjectKey(blocker.subjectType, blocker.subjectId),
    );
    if (!diagnostic) continue;
    const actionableDecisionIds = (decisionsByEndpoint.get(blocker.blockerId) ?? []).map(
      (decision) => decision.nodeId,
    );
    diagnostic.blockers.push({
      blockerId: blocker.blockerId,
      blockerType: blocker.blockerType,
      blockerState: blocker.blockerState,
      blockerLabel: blocker.blockerLabel,
      hasActionablePrerequisite: actionableDecisionIds.length > 0,
      actionableDecisionIds,
    });
    for (const decisionId of actionableDecisionIds) {
      edges.push({
        kind: "unblocks",
        fromNodeId: decisionId,
        toNodeId: diagnostic.nodeId,
        blockerId: blocker.blockerId,
      });
      const blockedSubjects = blockedSubjectsByDecision.get(decisionId) ?? new Set<string>();
      blockedSubjects.add(diagnostic.subjectId);
      blockedSubjectsByDecision.set(decisionId, blockedSubjects);
    }
  }

  for (const decision of decisions) {
    const blockedSubjectIds = [...(blockedSubjectsByDecision.get(decision.nodeId) ?? [])].sort();
    decision.blockedSubjectIds = blockedSubjectIds;
    decision.downstreamBlockedCount = blockedSubjectIds.length;
  }

  decisions.sort((left, right) =>
    right.downstreamBlockedCount - left.downstreamBlockedCount ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.itemType.localeCompare(right.itemType) ||
    left.subjectId.localeCompare(right.subjectId)
  );

  return { decisions, diagnostics, edges };
}

function readDecisionNodes(store: Pick<WorkbenchStore, "db">): UnresolvedDecisionNode[] {
  return queryAll<DecisionRow>(
    store.db,
    `select review_items.review_item_id as reviewItemId,
            review_items.item_type as itemType,
            review_items.subject_id as subjectId,
            coalesce(
              entity_source.source_id,
              relationship_source.source_id,
              legal_source.source_id,
              case when review_items.item_type = 'placeholder_entity' then 'workbench' end,
              'unknown'
            ) as sourceId,
            review_items.reason,
            review_items.default_action as defaultAction,
            review_items.status,
            review_items.details_json as detailsJson
     from review_items
     left join entity_candidates
       on entity_candidates.candidate_id = review_items.subject_id
     left join source_items as entity_source
       on entity_source.source_item_id = entity_candidates.source_item_id
     left join relationship_candidates
       on relationship_candidates.relationship_candidate_id = review_items.subject_id
     left join source_items as relationship_source
       on relationship_source.source_item_id = relationship_candidates.source_item_id
     left join legal_refs
       on legal_refs.legal_ref_id = review_items.subject_id
     left join source_items as legal_source
       on legal_source.source_item_id = legal_refs.source_item_id
     where review_items.status = 'open'
       and review_items.item_type != 'source_status'
     order by review_items.updated_at, review_items.review_item_id`,
  ).map((row) => ({
    nodeId: decisionNodeId(row.reviewItemId),
    reviewItemId: row.reviewItemId,
    itemType: row.itemType,
    subjectId: row.subjectId,
    sourceId: row.sourceId ?? "unknown",
    reason: row.reason,
    defaultAction: row.defaultAction,
    status: row.status,
    details: parseDetails(row.detailsJson),
    downstreamBlockedCount: 0,
    blockedSubjectIds: [],
  }));
}

function readDiagnosticNodes(store: Pick<WorkbenchStore, "db">): UnresolvedDiagnosticNode[] {
  return queryAll<DiagnosticRow>(
    store.db,
    `select reconciliation_items.subject_type as subjectType,
            reconciliation_items.subject_id as subjectId,
            source_items.source_id as sourceId,
            reconciliation_items.state,
            reconciliation_items.reason,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.raw_value as rawValue
     from reconciliation_items
     join relationship_candidates
       on relationship_candidates.relationship_candidate_id = reconciliation_items.subject_id
     join source_items
       on source_items.source_item_id = relationship_candidates.source_item_id
     where reconciliation_items.state = 'blocked'
     order by reconciliation_items.updated_at, reconciliation_items.subject_id`,
  ).map((row) => ({
    nodeId: diagnosticNodeId(row.subjectType, row.subjectId),
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    sourceId: row.sourceId,
    state: row.state,
    reason: row.reason,
    relationshipType: row.relationshipType ?? undefined,
    rawValue: row.rawValue ?? undefined,
    blockers: [],
  }));
}

function readBlockers(store: Pick<WorkbenchStore, "db">): BlockerRow[] {
  return queryAll<BlockerRow>(
    store.db,
    `select reconciliation_blockers.subject_type as subjectType,
            reconciliation_blockers.subject_id as subjectId,
            reconciliation_blockers.blocker_id as blockerId,
            reconciliation_blockers.blocker_type as blockerType,
            reconciliation_blockers.blocker_state as blockerState,
            coalesce(
              canonical_entities.name,
              (
                select entity_candidates.name
                from entity_candidates
                where entity_candidates.proposed_entity_id = reconciliation_blockers.blocker_id
                order by
                  case entity_candidates.review_status
                    when 'accepted' then 0
                    when 'pending' then 1
                    else 2
                  end,
                  coalesce(entity_candidates.confidence, 0) desc,
                  entity_candidates.candidate_id
                limit 1
              ),
              reconciliation_blockers.blocker_id
            ) as blockerLabel
     from reconciliation_blockers
     left join canonical_entities
       on canonical_entities.entity_id = reconciliation_blockers.blocker_id
     where reconciliation_blockers.subject_type = 'relationship_candidate'
     order by reconciliation_blockers.subject_type,
              reconciliation_blockers.subject_id,
              reconciliation_blockers.blocker_key`,
  );
}

function decisionsByProposedEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: UnresolvedDecisionNode[],
): Map<string, UnresolvedDecisionNode[]> {
  const entityDecisionIds = decisions
    .filter((decision) => decision.itemType === "entity_candidate")
    .map((decision) => decision.subjectId);
  if (entityDecisionIds.length === 0) return new Map();

  const placeholders = entityDecisionIds.map(() => "?").join(", ");
  const rows = queryAll<{ candidateId: string; proposedEntityId: string }>(
    store.db,
    `select candidate_id as candidateId,
            proposed_entity_id as proposedEntityId
     from entity_candidates
     where candidate_id in (${placeholders})`,
    entityDecisionIds,
  );
  const decisionsBySubject = new Map(decisions.map((decision) => [decision.subjectId, decision]));
  const result = new Map<string, UnresolvedDecisionNode[]>();
  for (const row of rows) {
    const decision = decisionsBySubject.get(row.candidateId);
    if (!decision) continue;
    const existing = result.get(row.proposedEntityId) ?? [];
    existing.push(decision);
    result.set(row.proposedEntityId, existing);
  }
  return result;
}

function decisionNodeId(reviewItemId: string): string {
  return `decision.${reviewItemId}`;
}

function diagnosticNodeId(subjectType: string, subjectId: string): string {
  return `diagnostic.${subjectType}.${subjectId}`;
}

function diagnosticSubjectKey(subjectType: string, subjectId: string): string {
  return `${subjectType}\u0000${subjectId}`;
}

function parseDetails(detailsJson: string): Record<string, unknown> {
  return JSON.parse(detailsJson) as Record<string, unknown>;
}
