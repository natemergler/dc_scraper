import type { ResolutionEventInput, ReviewItemRecord } from "../domain.ts";
import { type Workbench } from "../workbench.ts";
import { autoAcceptSafeRelationshipCandidates } from "./auto_accept_relationships.ts";
import { autoPromoteSafeEntityCandidates } from "./auto_promote.ts";
import { type EndpointStatus, endpointStatusMap } from "./endpoint_status.ts";
import { appendResolutionEvents } from "./resolution.ts";
import { reconcileRelationshipCandidates } from "./reconciliation.ts";
import { reviewFilterArgs, reviewModeSubcommand } from "./review_command_args.ts";
import {
  renderReviewPacketHeader,
  type ReviewPacketRecord,
  reviewPacketsFromItems,
} from "./review_packets.ts";
import { canBatchAcceptReviewItem, type ReviewItemFilters } from "./review.ts";
import {
  reviewEvidence,
  type ReviewEvidenceRow,
  type ReviewSubject,
  reviewSubject,
} from "./review_subject.ts";
import type { WorkbenchStore } from "./store.ts";
import {
  downstreamBlockedCountByReviewItem,
  type UnresolvedDecisionNode,
} from "./unresolved_work.ts";

interface ReviewSubjectContext {
  title: string;
  infoLabel?: string;
  sourceLine?: string;
  omittedDetailKeys: string[];
  relationshipEndpoints?: RelationshipEndpointContext;
}

interface RelationshipEndpointContext {
  from: EndpointStatus;
  to: EndpointStatus;
}

export async function runInteractiveReview(
  workbench: Pick<
    Workbench,
    "db" | "listReviewItems" | "appendResolutionEvent"
  >,
  filters: ReviewItemFilters,
  resolutionsDir: string,
): Promise<void> {
  const encoder = new TextEncoder();
  const activeFilters: ReviewItemFilters = filters.status === undefined
    ? { ...filters, status: "open" }
    : filters;
  autoPromoteSafeEntityCandidates(workbench);
  reconcileRelationshipCandidates(workbench);
  autoAcceptSafeRelationshipCandidates(workbench);
  let stickyPacketId: string | undefined;
  while (true) {
    const snapshot = buildInteractiveReviewSnapshot(workbench, activeFilters);
    if (snapshot.items.length === 0) {
      console.log("No review items remain.");
      return;
    }
    if (!stickyPacketId || !snapshot.packets.some((packet) => packet.packetId === stickyPacketId)) {
      stickyPacketId = await promptReviewInbox(workbench, snapshot);
      if (!stickyPacketId) {
        console.log(
          `Review stopped. ${snapshot.items.length} item(s) remain. Resume with ${
            renderResumeCommand(filters)
          }.`,
        );
        return;
      }
    }
    const selection = nextInteractiveReviewSelection(snapshot, stickyPacketId);
    const item = selection?.item;
    if (!item) {
      console.log("No review items remain.");
      return;
    }
    const packet = selection.packet;
    if (packet && packet.count > 1) {
      console.log(renderCurrentPacketSummary(workbench, snapshot, packet));
      console.log("");
    }
    if (selection?.decision && selection.decision.downstreamBlockedCount > 0) {
      console.log(renderDecisionImpact(selection.decision));
      console.log("");
    }
    console.log(renderReviewItem(workbench, item));
    const promptedAction = await promptLine(`Action [${actionPrompt(item)}]: `);
    if (promptedAction === undefined || promptedAction === "q") {
      console.log(
        `Review stopped. ${snapshot.items.length} item(s) remain. Resume with ${
          renderResumeCommand(filters)
        }.`,
      );
      return;
    }
    const action = promptedAction === "" ? defaultActionKey(item.defaultAction) : promptedAction;
    const event = await actionToEvent(item, action);
    if (!event) {
      console.log("That action is not available for this item.");
      continue;
    }
    await workbench.appendResolutionEvent(event, resolutionsDir);
    await Deno.stdout.write(encoder.encode("Saved resolution.\n"));
    stickyPacketId = packet?.packetId;
  }
}

interface InteractiveReviewSelection {
  packet?: ReviewPacketRecord;
  item: ReviewItemRecord;
  decision?: UnresolvedDecisionNode;
}

interface InteractiveReviewSnapshot {
  items: ReviewItemRecord[];
  itemsByReviewItemId: Map<string, ReviewItemRecord>;
  packets: ReviewPacketRecord[];
  rankedPackets: ReviewPacketRecord[];
  decisions: UnresolvedDecisionNode[];
  decisionsByReviewItemId: Map<string, UnresolvedDecisionNode>;
}

function buildInteractiveReviewSnapshot(
  workbench: Pick<Workbench, "db" | "listReviewItems">,
  filters: ReviewItemFilters,
): InteractiveReviewSnapshot {
  const items = workbench.listReviewItems({ ...filters, limit: undefined });
  const itemsByReviewItemId = new Map(items.map((item) => [item.reviewItemId, item]));
  const packets = reviewPacketsFromItems(workbench, items);
  const decisions = items.filter(isActionableInteractiveDecisionItem).map((item) => ({
    nodeId: `decision.${item.reviewItemId}`,
    reviewItemId: item.reviewItemId,
    itemType: item.itemType,
    subjectId: item.subjectId,
    sourceId: "unknown",
    reason: item.reason,
    defaultAction: item.defaultAction,
    status: item.status,
    details: item.details,
    downstreamBlockedCount: 0,
    blockedSubjectIds: [],
  } satisfies UnresolvedDecisionNode));
  const downstreamBlockedCount = downstreamBlockedCountByReviewItem(workbench, items);
  for (const decision of decisions) {
    decision.downstreamBlockedCount = downstreamBlockedCount.get(decision.reviewItemId) ?? 0;
  }
  decisions.sort((left, right) =>
    right.downstreamBlockedCount - left.downstreamBlockedCount ||
    left.reviewItemId.localeCompare(right.reviewItemId)
  );
  const decisionsByReviewItemId = new Map(
    decisions.map((decision) => [decision.reviewItemId, decision]),
  );
  const rankedPackets = rankPacketsByPriority(packets, decisionsByReviewItemId);
  return {
    items,
    itemsByReviewItemId,
    packets,
    rankedPackets,
    decisions,
    decisionsByReviewItemId,
  };
}

function isActionableInteractiveDecisionItem(item: ReviewItemRecord): boolean {
  return item.status === "open" && item.itemType !== "source_status";
}

function nextInteractiveReviewSelection(
  snapshot: InteractiveReviewSnapshot,
  stickyPacketId?: string,
): InteractiveReviewSelection | undefined {
  const packet = snapshot.packets.find((candidate) => candidate.packetId === stickyPacketId) ??
    selectPriorityPacket(snapshot.packets, snapshot.decisionsByReviewItemId);
  if (!packet) {
    const decision = snapshot.decisions.at(0);
    if (decision) {
      return { item: snapshot.itemsByReviewItemId.get(decision.reviewItemId)!, decision };
    }
    const item = snapshot.items.at(0);
    return item ? { item } : undefined;
  }
  const decision = packet.reviewItemIds
    .map((reviewItemId) => snapshot.decisionsByReviewItemId.get(reviewItemId))
    .filter((candidate): candidate is UnresolvedDecisionNode => Boolean(candidate))
    .sort((left, right) =>
      right.downstreamBlockedCount - left.downstreamBlockedCount ||
      left.reviewItemId.localeCompare(right.reviewItemId)
    )
    .at(0);
  const item = decision
    ? snapshot.itemsByReviewItemId.get(decision.reviewItemId)
    : packet.reviewItemIds
      .map((reviewItemId) => snapshot.itemsByReviewItemId.get(reviewItemId))
      .find((candidate): candidate is ReviewItemRecord => Boolean(candidate));
  return item ? { packet, item, decision } : undefined;
}

function renderDecisionImpact(decision: UnresolvedDecisionNode): string {
  const noun = decision.downstreamBlockedCount === 1 ? "relationship" : "relationships";
  return `Decision impact: unblocks ${decision.downstreamBlockedCount} blocked ${noun}.`;
}

function selectPriorityPacket(
  packets: ReviewPacketRecord[],
  decisionsByReviewItemId: Map<string, UnresolvedDecisionNode>,
): ReviewPacketRecord | undefined {
  return rankPacketsByPriority(packets, decisionsByReviewItemId).at(0);
}

function rankPacketsByPriority(
  packets: ReviewPacketRecord[],
  decisionsByReviewItemId: Map<string, UnresolvedDecisionNode>,
): ReviewPacketRecord[] {
  return [...packets].sort((left, right) =>
    packetPriorityScore(right, decisionsByReviewItemId) -
      packetPriorityScore(left, decisionsByReviewItemId) ||
    right.openCount - left.openCount ||
    right.count - left.count ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.packetId.localeCompare(right.packetId)
  );
}

function packetPriorityScore(
  packet: ReviewPacketRecord,
  decisionsByReviewItemId: Map<string, UnresolvedDecisionNode>,
): number {
  return packet.reviewItemIds.reduce((max, reviewItemId) => {
    const decision = decisionsByReviewItemId.get(reviewItemId);
    return Math.max(max, decision?.downstreamBlockedCount ?? 0);
  }, 0);
}

function renderReviewInbox(
  store: Pick<WorkbenchStore, "db">,
  snapshot: InteractiveReviewSnapshot,
): string {
  const choices = inboxChoices(store, snapshot);
  const lines = [
    "Decision inbox",
    `Open items in this slice: ${snapshot.items.length}`,
    "Choose a packet by the decision it will put in front of you:",
  ];
  for (const [index, choice] of choices.entries()) {
    lines.push(renderInboxChoiceLine(index, choice, snapshot));
  }
  return lines.join("\n");
}

async function promptReviewInbox(
  store: Pick<WorkbenchStore, "db">,
  snapshot: InteractiveReviewSnapshot,
): Promise<string | undefined> {
  const choices = inboxChoices(store, snapshot);
  if (choices.length === 0) return undefined;
  while (true) {
    console.log(renderReviewInbox(store, snapshot));
    console.log("");
    const response = await promptLine(`Choose [Enter=1, 1-${choices.length}, q]: `);
    if (response === undefined || response === "q") return undefined;
    if (response === "") return choices[0].packet.packetId;
    const selection = Number(response);
    if (Number.isInteger(selection) && selection >= 1 && selection <= choices.length) {
      return choices[selection - 1].packet.packetId;
    }
    console.log("That choice is not available.");
  }
}

function renderCurrentPacketSummary(
  store: Pick<WorkbenchStore, "db">,
  snapshot: InteractiveReviewSnapshot,
  packet: ReviewPacketRecord,
): string {
  const lines = [renderReviewPacketHeader(packet)];
  const preview = packetLeadPreview(store, snapshot, packet);
  if (preview) {
    lines.push(`Lead decision: ${preview}`);
  }
  return lines.join("\n");
}

function renderInboxChoiceLine(
  index: number,
  choice: ReviewInboxChoice,
  snapshot: Pick<InteractiveReviewSnapshot, "decisionsByReviewItemId">,
): string {
  const packet = choice.packet;
  const impact = packetPriorityScore(packet, snapshot.decisionsByReviewItemId);
  const scope = packet.relationshipType
    ? `${packet.sourceId} ${packet.relationshipType}`
    : packet.refType
    ? `${packet.sourceId} ${packet.refType}`
    : `${packet.sourceId} ${humanizeToken(packet.itemType)}`;
  const prefix = index === 0 ? `${index + 1}. [recommended]` : `${index + 1}.`;
  const impactText = impact > 0 ? `; unblocks ${impact}` : "";
  return `${prefix} ${choice.title} - ${scope} [default ${choice.defaultAction}; packet ${packet.openCount} open${impactText}]`;
}

interface ReviewInboxChoice {
  packet: ReviewPacketRecord;
  title: string;
  defaultAction: string;
}

function inboxChoices(
  store: Pick<WorkbenchStore, "db">,
  snapshot: InteractiveReviewSnapshot,
): ReviewInboxChoice[] {
  return snapshot.rankedPackets
    .slice(0, 5)
    .map((packet) => {
      const leadItem = leadingPacketItem(snapshot, packet);
      if (!leadItem) return undefined;
      return {
        packet,
        title: reviewItemTitle(store, leadItem),
        defaultAction: leadItem.defaultAction,
      } satisfies ReviewInboxChoice;
    })
    .filter((choice): choice is ReviewInboxChoice => Boolean(choice));
}

function packetLeadPreview(
  store: Pick<WorkbenchStore, "db">,
  snapshot: InteractiveReviewSnapshot,
  packet: ReviewPacketRecord,
): string | undefined {
  const leadItem = leadingPacketItem(snapshot, packet);
  if (!leadItem) return undefined;
  const impact = packetPriorityScore(packet, snapshot.decisionsByReviewItemId);
  const title = reviewItemTitle(store, leadItem);
  return impact > 0 ? `${title} [unblocks ${impact}]` : title;
}

function leadingPacketItem(
  snapshot: Pick<
    InteractiveReviewSnapshot,
    "itemsByReviewItemId" | "decisionsByReviewItemId"
  >,
  packet: ReviewPacketRecord,
): ReviewItemRecord | undefined {
  const decision = packet.reviewItemIds
    .map((reviewItemId) => snapshot.decisionsByReviewItemId.get(reviewItemId))
    .filter((candidate): candidate is UnresolvedDecisionNode => Boolean(candidate))
    .sort((left, right) =>
      right.downstreamBlockedCount - left.downstreamBlockedCount ||
      left.reviewItemId.localeCompare(right.reviewItemId)
    )
    .at(0);
  if (decision) {
    return snapshot.itemsByReviewItemId.get(decision.reviewItemId);
  }
  return packet.reviewItemIds
    .map((reviewItemId) => snapshot.itemsByReviewItemId.get(reviewItemId))
    .find((candidate): candidate is ReviewItemRecord => Boolean(candidate));
}

function reviewItemTitle(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string {
  return reviewSubjectContext(store, item, reviewSubject(store, item)).title;
}

function renderResumeCommand(filters: ReviewItemFilters): string {
  const parts = ["deno", "task", "dc", "--", "review"];
  const mode = reviewModeSubcommand(filters.mode);
  if (mode) parts.push(mode);
  parts.push(...reviewFilterArgs(filters, { includeMode: false, includeType: true }));
  return parts.join(" ");
}

export function renderReviewItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string {
  const subject = reviewSubject(store, item);
  const context = reviewSubjectContext(store, item, subject);
  const omittedDetailKeys = specialOmittedDetailKeys(item, context.omittedDetailKeys);
  return [
    `Review: ${context.title}`,
    [humanizeToken(item.itemType), context.infoLabel, item.status].filter(Boolean).join(" | "),
    context.sourceLine,
    `reason: ${item.reason}`,
    renderWhyDeferred(item),
    `default: ${renderDefaultAction(item)}`,
    `actions: ${availableActionLabels(item).join(", ")}`,
    `ids: subject=${item.subjectId}, review=${item.reviewItemId}`,
    ...renderRelationshipBlock(item, subject, context.relationshipEndpoints),
    ...renderDetailsBlock(item.details, omittedDetailKeys),
    ...renderEvidenceBlock(reviewEvidence(store, item)),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function renderReviewItemSummary(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string {
  const context = reviewSubjectContext(store, item, reviewSubject(store, item));
  const details = compactDetails(
    item.details,
    specialOmittedDetailKeys(item, context.omittedDetailKeys),
  );
  return [
    `[${item.status}] ${context.title}`,
    [humanizeToken(item.itemType), context.infoLabel, `default ${item.defaultAction}`].filter(
      Boolean,
    ).join(" | "),
    context.sourceLine,
    `reason: ${item.reason}`,
    renderWhyDeferred(item),
    `ids: subject=${item.subjectId}, review=${item.reviewItemId}`,
    details ? `details: ${details}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export async function runBatchAcceptSafe(
  workbench: Pick<Workbench, "db" | "listReviewItems" | "appendResolutionEvent">,
  filters: ReviewItemFilters,
  resolutionsDir: string,
): Promise<void> {
  const items = workbench.listReviewItems(filters);
  const accepted: ReviewItemRecord[] = [];
  const skipped: ReviewItemRecord[] = [];
  for (const item of items) {
    if (!canBatchAcceptReviewItem(workbench, item, filters)) {
      skipped.push(item);
      continue;
    }
    accepted.push(item);
  }
  if (accepted.length > 0) {
    await appendResolutionEvents(
      workbench,
      accepted.map((item) => batchAcceptEvent(item)),
      resolutionsDir,
    );
  }
  console.log(`Accepted ${accepted.length} safe review item(s).`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} item(s) that were not safe to auto-accept.`);
  }
}

export async function runBatchDeferDefault(
  workbench: Pick<Workbench, "db" | "listReviewItems">,
  filters: ReviewItemFilters,
  resolutionsDir: string,
): Promise<void> {
  if (!isScopedDefaultDeferBatch(filters)) {
    throw new Error(
      "Batch defer-default requires --mode, --subject-prefix, and at least one narrowing filter.",
    );
  }
  const items = workbench.listReviewItems({ ...filters, status: "open" });
  const deferred = items.filter((item) => item.defaultAction === "defer");
  const skipped = items.length - deferred.length;
  if (deferred.length > 0) {
    await appendResolutionEvents(
      workbench,
      deferred.map((item) => batchDeferEvent(item)),
      resolutionsDir,
    );
  }
  console.log(`Deferred ${deferred.length} default-defer review item(s).`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} item(s) whose default action was not defer.`);
  }
}

function isScopedDefaultDeferBatch(filters: ReviewItemFilters): boolean {
  return Boolean(
    filters.mode &&
      filters.subjectPrefix &&
      (filters.type || filters.relationshipType || filters.rawValue || filters.rawValueContains ||
        filters.refType),
  );
}

function batchAcceptEvent(item: ReviewItemRecord): ResolutionEventInput {
  if (item.itemType === "relationship_candidate") {
    return { eventType: "accept_relationship_candidate", subjectId: item.subjectId, payload: {} };
  }
  if (item.itemType === "legal_ref") {
    return { eventType: "accept_legal_ref", subjectId: item.subjectId, payload: {} };
  }
  return { eventType: "accept_entity_candidate", subjectId: item.subjectId, payload: {} };
}

function batchDeferEvent(item: ReviewItemRecord): ResolutionEventInput {
  return { eventType: "defer_review_item", subjectId: item.reviewItemId, payload: {} };
}

async function actionToEvent(
  item: ReviewItemRecord,
  action: string,
): Promise<ResolutionEventInput | undefined> {
  if (item.itemType === "entity_candidate") {
    if (action === "a") {
      return { eventType: "accept_entity_candidate", subjectId: item.subjectId, payload: {} };
    }
    if (action === "r") {
      return { eventType: "reject_entity_candidate", subjectId: item.subjectId, payload: {} };
    }
    if (action === "m") {
      const entityId = await promptLine("Merge into entity id: ");
      return {
        eventType: "merge_entity_candidates",
        subjectId: item.subjectId,
        payload: { entityId, candidateIds: [item.subjectId] },
      };
    }
  }
  if (item.itemType === "relationship_candidate") {
    if (action === "a") {
      return { eventType: "accept_relationship_candidate", subjectId: item.subjectId, payload: {} };
    }
    if (action === "e") {
      const relationshipType = await promptLine("Relationship type: ");
      const fromEntityId = await promptLine("From entity id (blank keeps source): ");
      const toEntityId = await promptLine("To entity id (blank keeps source): ");
      const payload: Record<string, unknown> = {};
      if (relationshipType) payload.relationshipType = relationshipType;
      if (fromEntityId) payload.fromEntityId = fromEntityId;
      if (toEntityId) payload.toEntityId = toEntityId;
      return {
        eventType: "accept_relationship_candidate",
        subjectId: item.subjectId,
        payload,
      };
    }
    if (action === "r") {
      return { eventType: "reject_relationship_candidate", subjectId: item.subjectId, payload: {} };
    }
  }
  if (item.itemType === "legal_ref") {
    if (action === "a") {
      return { eventType: "accept_legal_ref", subjectId: item.subjectId, payload: {} };
    }
    if (action === "n") {
      const refType = await promptLine("Ref type: ");
      const normalizedCitation = await promptLine("Normalized citation: ");
      const payload: Record<string, unknown> = {};
      if (refType) payload.refType = refType;
      if (normalizedCitation) payload.normalizedCitation = normalizedCitation;
      return {
        eventType: "accept_legal_ref",
        subjectId: item.subjectId,
        payload,
      };
    }
    if (action === "r") {
      return { eventType: "reject_legal_ref", subjectId: item.subjectId, payload: {} };
    }
  }
  if (action === "d") {
    return { eventType: "defer_review_item", subjectId: item.reviewItemId, payload: {} };
  }
  return undefined;
}

function defaultActionKey(defaultAction: string): string {
  if (defaultAction === "accept") return "a";
  if (defaultAction === "reject") return "r";
  if (defaultAction === "defer") return "d";
  return defaultAction;
}

function renderDefaultAction(item: ReviewItemRecord): string {
  return `${item.defaultAction} (Enter or ${defaultActionKey(item.defaultAction)})`;
}

function renderWhyDeferred(item: ReviewItemRecord): string | undefined {
  return typeof item.details.whyDeferred === "string"
    ? `why deferred: ${item.details.whyDeferred}`
    : undefined;
}

function specialOmittedDetailKeys(item: ReviewItemRecord, omittedKeys: string[]): string[] {
  return typeof item.details.whyDeferred === "string"
    ? [...omittedKeys, "whyDeferred"]
    : omittedKeys;
}

function actionPrompt(item: ReviewItemRecord): string {
  const keys = availableActionKeys(item).map((key) => key === "" ? "Enter" : key);
  return keys.join("/");
}

function availableActionLabels(item: ReviewItemRecord): string[] {
  return availableActionKeys(item).map((key) => {
    if (key === "") return `Enter ${item.defaultAction}`;
    if (key === "a") return "a accept";
    if (key === "r") return "r reject";
    if (key === "m") return "m merge";
    if (key === "e") return "e edit type/endpoints and accept";
    if (key === "n") return "n normalize and accept";
    if (key === "d") return "d defer";
    if (key === "q") return "q quit";
    return key;
  });
}

function availableActionKeys(item: ReviewItemRecord): string[] {
  if (item.itemType === "entity_candidate") return ["", "a", "r", "m", "d", "q"];
  if (item.itemType === "relationship_candidate") return ["", "a", "e", "r", "d", "q"];
  if (item.itemType === "legal_ref") return ["", "a", "n", "r", "d", "q"];
  return ["", "d", "q"];
}

function renderDetailsBlock(
  details: Record<string, unknown>,
  omittedKeys: string[],
): string[] {
  const omit = new Set(omittedKeys);
  const entries = Object.entries(details)
    .filter(([key]) => !omit.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return [];
  return [
    "details:",
    ...entries.map(([key, value]) => `- ${key}: ${formatDetailValue(value)}`),
  ];
}

function renderRelationshipBlock(
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
  endpoints: RelationshipEndpointContext | undefined,
): string[] {
  if (item.itemType !== "relationship_candidate") return [];
  if (!subject || subject.itemType !== "relationship_candidate") return [];
  if (!endpoints) return [];
  const relationship = subject;
  return [
    "relationship:",
    `- type: ${relationship.relationshipType}`,
    `- from: ${renderEndpointStatus(endpoints.from)}`,
    `- to: ${renderEndpointStatus(endpoints.to)}`,
    `- source: ${relationship.source.sourceId} / ${relationship.source.itemTitle}`,
    relationship.rawValue ? `- raw value: ${relationship.rawValue}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function renderEndpointStatus(endpoint: EndpointStatus): string {
  const name = endpoint.name ? ` ${JSON.stringify(endpoint.name)}` : "";
  const note = endpointStatusNote(endpoint);
  return `${endpoint.entityId}${name} (${endpoint.state}${note ? `; ${note}` : ""})`;
}

function endpointStatusNote(endpoint: EndpointStatus): string | undefined {
  if (endpoint.state === "placeholder") return "review placeholder before relying on this edge";
  if (endpoint.state === "pending_candidate") return "accept an endpoint candidate first";
  if (endpoint.state === "deferred_candidate") return "resume deferred endpoint review first";
  if (endpoint.state === "stale_candidate") return "resolve changed prior endpoint decision first";
  if (endpoint.state === "replay_conflict") return "fix endpoint replay conflict first";
  if (endpoint.state === "rejected_candidate") return "prior endpoint candidate was rejected";
  if (endpoint.state === "missing") return "endpoint has no source-backed candidate yet";
  return undefined;
}

function renderEvidenceBlock(evidence: ReviewEvidenceRow[]): string[] {
  if (evidence.length === 0) return ["evidence: none"];
  return [
    "evidence:",
    ...evidence.slice(0, 8).flatMap((row) => [
      `- ${row.sourceId}: ${row.fieldPath} <- ${row.observedValue}`,
      `  artifact: ${row.artifactPath}`,
    ]),
  ];
}

function compactDetails(details: Record<string, unknown>, omittedKeys: string[] = []): string {
  const omit = new Set(omittedKeys);
  const entries = Object.entries(details)
    .filter(([key]) => !omit.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}=${formatDetailValue(value)}`)
    .join(" ");
}

function reviewSubjectContext(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
): ReviewSubjectContext {
  if (item.itemType === "entity_candidate") {
    return {
      title: subject?.itemType === "entity_candidate" ? subject.name : item.subjectId,
      infoLabel: subject?.itemType === "entity_candidate"
        ? humanizeToken(subject.entityKind)
        : undefined,
      sourceLine: subject?.itemType === "entity_candidate" ? sourceLine(subject.source) : undefined,
      omittedDetailKeys: ["name", "kind"],
    };
  }
  if (item.itemType === "relationship_candidate") {
    if (subject?.itemType === "relationship_candidate") {
      const relationship = subject;
      const relationshipEndpoints = relationshipEndpointContext(store, relationship);
      return {
        title: relationship.rawValue ??
          `${endpointTitle(relationshipEndpoints.from)} -> ${
            endpointTitle(relationshipEndpoints.to)
          }`,
        infoLabel: humanizeToken(relationship.relationshipType),
        sourceLine: sourceLine(relationship.source),
        omittedDetailKeys: [],
        relationshipEndpoints,
      };
    }
  }
  if (item.itemType === "legal_ref") {
    return {
      title: subject?.itemType === "legal_ref" ? subject.citationText : item.subjectId,
      infoLabel: subject?.itemType === "legal_ref" ? humanizeToken(subject.refType) : undefined,
      sourceLine: subject?.itemType === "legal_ref" ? sourceLine(subject.source) : undefined,
      omittedDetailKeys: [],
    };
  }
  return {
    title: item.subjectId,
    omittedDetailKeys: [],
  };
}

function relationshipEndpointContext(
  store: Pick<WorkbenchStore, "db">,
  relationship: Extract<ReviewSubject, { itemType: "relationship_candidate" }>,
): RelationshipEndpointContext {
  const statuses = endpointStatusMap(store, [
    relationship.fromEntityRef,
    relationship.toEntityRef,
  ]);
  return {
    from: statuses.get(relationship.fromEntityRef) ?? {
      entityId: relationship.fromEntityRef,
      state: "missing",
    },
    to: statuses.get(relationship.toEntityRef) ?? {
      entityId: relationship.toEntityRef,
      state: "missing",
    },
  };
}

function endpointTitle(endpoint: EndpointStatus): string {
  return endpoint.name ?? endpoint.entityId;
}

function sourceLine(source: { sourceId: string; itemTitle: string }): string {
  return `source: ${source.sourceId} / ${source.itemTitle}`;
}

function humanizeToken(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDetailValue(value: unknown): string {
  if (typeof value === "string") {
    return value.includes(" ") || value.includes(":") ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value);
}

async function promptLine(promptText: string): Promise<string | undefined> {
  await Deno.stdout.write(new TextEncoder().encode(promptText));
  while (!stdinBuffer.includes("\n")) {
    const buffer = new Uint8Array(1024);
    const read = await Deno.stdin.read(buffer);
    if (read === null) {
      if (stdinBuffer.length === 0) return undefined;
      break;
    }
    stdinBuffer += new TextDecoder().decode(buffer.subarray(0, read));
  }
  const newlineIndex = stdinBuffer.indexOf("\n");
  if (newlineIndex === -1) {
    const remaining = stdinBuffer.trim();
    stdinBuffer = "";
    return remaining;
  }
  const line = stdinBuffer.slice(0, newlineIndex).trim();
  stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
  return line;
}

let stdinBuffer = "";
