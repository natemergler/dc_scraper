import {
  buildEntityId,
  type ReviewItemRecord,
  type ReviewItemType,
  type ReviewStatus,
} from "../domain.ts";
import { queryAll } from "./db.ts";
import { isHumanDecisionReviewItem } from "./review.ts";
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

export interface UnresolvedReconciliationSummary {
  blockedCount: number;
  blockedBySource: Array<{ sourceId: string; count: number }>;
  blockedByBlockerState: Array<{ blockerState: string; count: number }>;
  blockedByRelationshipType: Array<{ relationshipType: string; count: number }>;
  blockedFamilies: Array<{
    sourceId: string;
    relationshipType: string;
    blockerId: string;
    blockerLabel: string;
    blockerState: string;
    count: number;
  }>;
  blockedByReason: Array<{ reason: string; count: number }>;
  firstBlocked?: {
    subjectId: string;
    sourceId: string;
    reason: string;
    relationshipType: string;
    rawValue?: string | null;
    blockers: Array<{
      blockerId: string;
      blockerState: string;
      blockerLabel: string;
    }>;
  };
  topUnblocker?: {
    reviewItemId: string;
    itemType: ReviewItemType;
    subjectId: string;
    sourceId: string;
    reason: string;
    defaultAction: string;
    downstreamBlockedCount: number;
  };
}

type DecisionImpactInput = Pick<ReviewItemRecord, "reviewItemId" | "itemType" | "subjectId">;

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

interface LegalDecisionEndpointRow {
  legalRefId: string;
  citationText: string;
  normalizedCitation?: string | null;
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
  const decisionsByEndpoint = decisionsByBlockerEndpoint(store, decisions);
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

export function summarizeUnresolvedReconciliation(
  graph: UnresolvedWorkGraph,
): UnresolvedReconciliationSummary {
  const firstDiagnostic = graph.diagnostics[0];
  const topUnblocker = graph.decisions.find((decision) => decision.downstreamBlockedCount > 0);
  return {
    blockedCount: graph.diagnostics.length,
    blockedBySource: countByKey(graph.diagnostics, "sourceId"),
    blockedByBlockerState: countByKey(
      graph.diagnostics.flatMap((diagnostic) => diagnostic.blockers),
      "blockerState",
    ),
    blockedByRelationshipType: countByMappedKey(
      graph.diagnostics,
      (diagnostic) => diagnostic.relationshipType ?? "unknown",
      "relationshipType",
    ),
    blockedFamilies: summarizeBlockedFamilies(graph.diagnostics),
    blockedByReason: countByKey(graph.diagnostics, "reason"),
    firstBlocked: firstDiagnostic
      ? {
        subjectId: firstDiagnostic.subjectId,
        sourceId: firstDiagnostic.sourceId,
        reason: firstDiagnostic.reason,
        relationshipType: firstDiagnostic.relationshipType ?? "unknown",
        rawValue: firstDiagnostic.rawValue,
        blockers: firstDiagnostic.blockers.map((blocker) => ({
          blockerId: blocker.blockerId,
          blockerState: blocker.blockerState,
          blockerLabel: blocker.blockerLabel,
        })),
      }
      : undefined,
    topUnblocker: topUnblocker
      ? {
        reviewItemId: topUnblocker.reviewItemId,
        itemType: topUnblocker.itemType,
        subjectId: topUnblocker.subjectId,
        sourceId: topUnblocker.sourceId,
        reason: topUnblocker.reason,
        defaultAction: topUnblocker.defaultAction,
        downstreamBlockedCount: topUnblocker.downstreamBlockedCount,
      }
      : undefined,
  };
}

function summarizeBlockedFamilies(
  diagnostics: UnresolvedDiagnosticNode[],
): UnresolvedReconciliationSummary["blockedFamilies"] {
  const families = new Map<string, UnresolvedReconciliationSummary["blockedFamilies"][number]>();
  for (const diagnostic of diagnostics) {
    const relationshipType = diagnostic.relationshipType ?? "unknown";
    for (const blocker of diagnostic.blockers) {
      const familyKey = [
        diagnostic.sourceId,
        relationshipType,
        blocker.blockerId,
        blocker.blockerState,
      ].join("\u0000");
      const existing = families.get(familyKey);
      if (existing) {
        existing.count += 1;
        continue;
      }
      families.set(familyKey, {
        sourceId: diagnostic.sourceId,
        relationshipType,
        blockerId: blocker.blockerId,
        blockerLabel: blocker.blockerLabel,
        blockerState: blocker.blockerState,
        count: 1,
      });
    }
  }
  return [...families.values()].sort((left, right) =>
    right.count - left.count ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.relationshipType.localeCompare(right.relationshipType) ||
    left.blockerId.localeCompare(right.blockerId) ||
    left.blockerState.localeCompare(right.blockerState)
  );
}

export function downstreamBlockedCountByReviewItem(
  store: Pick<WorkbenchStore, "db">,
  decisions: readonly DecisionImpactInput[],
): Map<string, number> {
  const impacts = new Map(decisions.map((decision) => [decision.reviewItemId, 0]));
  if (decisions.length === 0) return impacts;
  const decisionsByEndpoint = decisionReviewItemsByEndpoint(store, decisions);
  const endpointIds = [...decisionsByEndpoint.keys()];
  if (endpointIds.length === 0) return impacts;

  const blockedSubjectsByReviewItemId = new Map<string, Set<string>>();
  for (const endpointChunk of chunks(endpointIds, 500)) {
    const placeholders = endpointChunk.map(() => "?").join(", ");
    const rows = queryAll<{ blockerId: string; subjectId: string }>(
      store.db,
      `select reconciliation_blockers.blocker_id as blockerId,
              reconciliation_blockers.subject_id as subjectId
       from reconciliation_blockers
       join reconciliation_items
         on reconciliation_items.subject_type = reconciliation_blockers.subject_type
        and reconciliation_items.subject_id = reconciliation_blockers.subject_id
       where reconciliation_blockers.subject_type = 'relationship_candidate'
         and reconciliation_items.state = 'blocked'
         and reconciliation_blockers.blocker_id in (${placeholders})`,
      endpointChunk,
    );
    for (const row of rows) {
      for (const reviewItemId of decisionsByEndpoint.get(row.blockerId) ?? []) {
        const blockedSubjects = blockedSubjectsByReviewItemId.get(reviewItemId) ??
          new Set<string>();
        blockedSubjects.add(row.subjectId);
        blockedSubjectsByReviewItemId.set(reviewItemId, blockedSubjects);
      }
    }
  }

  for (const [reviewItemId, blockedSubjects] of blockedSubjectsByReviewItemId.entries()) {
    impacts.set(reviewItemId, blockedSubjects.size);
  }
  return impacts;
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
  })).filter(isHumanDecisionReviewItem);
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

function decisionsByBlockerEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: UnresolvedDecisionNode[],
): Map<string, UnresolvedDecisionNode[]> {
  const result = new Map<string, UnresolvedDecisionNode[]>();
  for (const decision of decisions) {
    if (decision.itemType === "placeholder_entity") {
      addDecisionByEndpoint(result, decision.subjectId, decision);
    }
  }
  addEntityCandidateDecisionsByEndpoint(store, decisions, result);
  addLegalRefDecisionsByEndpoint(store, decisions, result);
  return result;
}

function decisionReviewItemsByEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: readonly DecisionImpactInput[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const decision of decisions) {
    if (decision.itemType === "placeholder_entity") {
      addReviewItemByEndpoint(result, decision.subjectId, decision.reviewItemId);
    }
  }
  addEntityCandidateReviewItemsByEndpoint(store, decisions, result);
  addLegalRefReviewItemsByEndpoint(store, decisions, result);
  return result;
}

function addEntityCandidateDecisionsByEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: UnresolvedDecisionNode[],
  result: Map<string, UnresolvedDecisionNode[]>,
): void {
  const entityDecisionIds = decisions
    .filter((decision) => decision.itemType === "entity_candidate")
    .map((decision) => decision.subjectId);
  if (entityDecisionIds.length === 0) return;

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
  for (const row of rows) {
    const decision = decisionsBySubject.get(row.candidateId);
    if (!decision) continue;
    addDecisionByEndpoint(result, row.proposedEntityId, decision);
  }
}

function addEntityCandidateReviewItemsByEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: readonly DecisionImpactInput[],
  result: Map<string, string[]>,
): void {
  const entityDecisionIds = decisions
    .filter((decision) => decision.itemType === "entity_candidate")
    .map((decision) => decision.subjectId);
  if (entityDecisionIds.length === 0) return;

  const placeholders = entityDecisionIds.map(() => "?").join(", ");
  const rows = queryAll<{ candidateId: string; proposedEntityId: string }>(
    store.db,
    `select candidate_id as candidateId,
            proposed_entity_id as proposedEntityId
     from entity_candidates
     where candidate_id in (${placeholders})`,
    entityDecisionIds,
  );
  const reviewItemIdBySubject = new Map(
    decisions.map((decision) => [decision.subjectId, decision.reviewItemId]),
  );
  for (const row of rows) {
    const reviewItemId = reviewItemIdBySubject.get(row.candidateId);
    if (!reviewItemId) continue;
    addReviewItemByEndpoint(result, row.proposedEntityId, reviewItemId);
  }
}

function addLegalRefDecisionsByEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: UnresolvedDecisionNode[],
  result: Map<string, UnresolvedDecisionNode[]>,
): void {
  const legalDecisionIds = decisions
    .filter((decision) => decision.itemType === "legal_ref")
    .map((decision) => decision.subjectId);
  if (legalDecisionIds.length === 0) return;

  const placeholders = legalDecisionIds.map(() => "?").join(", ");
  const rows = queryAll<LegalDecisionEndpointRow>(
    store.db,
    `select legal_ref_id as legalRefId,
            citation_text as citationText,
            normalized_citation as normalizedCitation
     from legal_refs
     where legal_ref_id in (${placeholders})`,
    legalDecisionIds,
  );
  const decisionsBySubject = new Map(decisions.map((decision) => [decision.subjectId, decision]));
  for (const row of rows) {
    const decision = decisionsBySubject.get(row.legalRefId);
    if (!decision) continue;
    addDecisionByEndpoint(
      result,
      buildEntityId(row.normalizedCitation ?? row.citationText, "legal"),
      decision,
    );
  }
}

function addLegalRefReviewItemsByEndpoint(
  store: Pick<WorkbenchStore, "db">,
  decisions: readonly DecisionImpactInput[],
  result: Map<string, string[]>,
): void {
  const legalDecisionIds = decisions
    .filter((decision) => decision.itemType === "legal_ref")
    .map((decision) => decision.subjectId);
  if (legalDecisionIds.length === 0) return;

  const placeholders = legalDecisionIds.map(() => "?").join(", ");
  const rows = queryAll<LegalDecisionEndpointRow>(
    store.db,
    `select legal_ref_id as legalRefId,
            citation_text as citationText,
            normalized_citation as normalizedCitation
     from legal_refs
     where legal_ref_id in (${placeholders})`,
    legalDecisionIds,
  );
  const reviewItemIdBySubject = new Map(
    decisions.map((decision) => [decision.subjectId, decision.reviewItemId]),
  );
  for (const row of rows) {
    const reviewItemId = reviewItemIdBySubject.get(row.legalRefId);
    if (!reviewItemId) continue;
    addReviewItemByEndpoint(
      result,
      buildEntityId(row.normalizedCitation ?? row.citationText, "legal"),
      reviewItemId,
    );
  }
}

function addDecisionByEndpoint(
  decisionsByEndpoint: Map<string, UnresolvedDecisionNode[]>,
  endpointId: string,
  decision: UnresolvedDecisionNode,
): void {
  const existing = decisionsByEndpoint.get(endpointId) ?? [];
  existing.push(decision);
  decisionsByEndpoint.set(endpointId, existing);
}

function addReviewItemByEndpoint(
  reviewItemsByEndpoint: Map<string, string[]>,
  endpointId: string,
  reviewItemId: string,
): void {
  const existing = reviewItemsByEndpoint.get(endpointId) ?? [];
  existing.push(reviewItemId);
  reviewItemsByEndpoint.set(endpointId, existing);
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

function countByKey<T extends Record<K, string>, K extends string>(
  rows: T[],
  key: K,
): Array<{ [P in K]: string } & { count: number }> {
  return countByMappedKey(rows, (row) => row[key], key);
}

function countByMappedKey<T, K extends string>(
  rows: T[],
  keyOf: (row: T) => string,
  keyName: K,
): Array<{ [P in K]: string } & { count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || leftKey.localeCompare(rightKey)
    )
    .map(([key, count]) => ({ [keyName]: key, count } as { [P in K]: string } & {
      count: number;
    }));
}

function parseDetails(detailsJson: string): Record<string, unknown> {
  return JSON.parse(detailsJson) as Record<string, unknown>;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
