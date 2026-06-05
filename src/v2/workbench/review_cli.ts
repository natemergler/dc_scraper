import { dcCommand } from "../command_prefix.ts";
import type { ResolutionEventInput, ReviewItemRecord } from "../domain.ts";
import { type Workbench } from "../workbench.ts";
import { type EndpointStatus, endpointStatusMap } from "./endpoint_status.ts";
import { materializeReviewReadyFacts } from "./materialization.ts";
import { appendResolutionEvents } from "./resolution.ts";
import { renderReviewCommand } from "./review_command_args.ts";
import { canBatchAcceptReviewItem, isScopedDefaultDeferBatch } from "./review_batch.ts";
import {
  rankReviewPacketsByPriority,
  renderReviewPacketHeader,
  type ReviewPacketPriorityDecision,
  reviewPacketPriorityDecisionMap,
  reviewPacketPriorityScore,
  type ReviewPacketRecord,
  reviewPacketsFromItems,
} from "./review_packets.ts";
import { type ReviewItemFilters, reviewItemWorkKind } from "./review.ts";
import {
  reviewEvidence,
  type ReviewEvidenceRow,
  type ReviewSubject,
  reviewSubject,
} from "./review_subject.ts";
import type { WorkbenchStore } from "./store.ts";
import {
  buildUnresolvedWorkGraph,
  projectOpenHumanDecisionWork,
  type UnresolvedDecisionNode,
  type UnresolvedDiagnosticNode,
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

interface ReviewSessionCounts {
  accepted: number;
  rejected: number;
  normalized: number;
  edited: number;
  skipped: number;
  deferred: number;
}

interface RenderReviewItemOptions {
  position?: number;
  total?: number;
  raw?: boolean;
}

type InteractiveReviewWorkbench = Pick<
  Workbench,
  "db" | "dbPath" | "listReviewItems" | "appendResolutionEvent"
>;

export async function runInteractiveReview(
  workbench: InteractiveReviewWorkbench,
  filters: ReviewItemFilters,
  resolutionsDir: string,
): Promise<void> {
  const encoder = new TextEncoder();
  const activeFilters: ReviewItemFilters = filters.status === undefined
    ? { ...filters, status: "open" }
    : filters;
  materializeReviewReadyFacts(workbench);
  let stickyPacketId: string | undefined;
  const sessionCounts = emptySessionCounts();
  while (true) {
    const snapshot = buildInteractiveReviewSnapshot(workbench, activeFilters);
    if (snapshot.items.length === 0) {
      if (snapshot.blockedDiagnosticCount > 0) {
        console.log(renderBlockedDiagnosticsOnlyMessage(snapshot));
      } else if (snapshot.browseOnlyItemCount > 0) {
        console.log(
          `No human decisions remain. Browse ${snapshot.browseOnlyItemCount} source-backed row(s) with ${
            renderReviewListCommand(filters)
          } or ${renderReviewPacketsCommand(filters)}.`,
        );
      } else {
        printReviewSessionSummary(workbench, sessionCounts, filters);
      }
      return;
    }
    if (
      snapshot.rankedPackets.length === 1 &&
      snapshot.rankedPackets[0].reviewItemIds.length === 1
    ) {
      stickyPacketId = snapshot.rankedPackets[0].packetId;
    } else if (
      !stickyPacketId || !snapshot.packets.some((packet) => packet.packetId === stickyPacketId)
    ) {
      stickyPacketId = await promptReviewInbox(workbench, snapshot);
      if (!stickyPacketId) {
        printReviewSessionSummary(workbench, sessionCounts, filters);
        return;
      }
    }
    const selection = nextInteractiveReviewSelection(snapshot, stickyPacketId);
    const item = selection?.item;
    if (!item) {
      printReviewSessionSummary(workbench, sessionCounts, filters);
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
    console.log(renderReviewItem(workbench, item, {
      position: snapshot.items.findIndex((candidate) =>
        candidate.reviewItemId === item.reviewItemId
      ) +
        1,
      total: snapshot.items.length,
    }));
    const promptedAction = await promptLine(`Action [${actionPrompt(item)}]: `);
    if (promptedAction === undefined || promptedAction === "q") {
      printReviewSessionSummary(workbench, sessionCounts, filters);
      return;
    }
    const action = promptedAction === "" ? "s" : promptedAction;
    if (action === "s") {
      sessionCounts.skipped += 1;
      console.log("Skipped. This card will stay open.");
      stickyPacketId = undefined;
      continue;
    }
    if (action === "v" || action === "raw") {
      console.log(renderReviewItem(workbench, item, { raw: true }));
      console.log("");
      continue;
    }
    const event = await actionToEvent(item, action);
    if (!event) {
      console.log(
        `That action is not available. Use ${sentenceList(availableActionLabels(item))}.`,
      );
      continue;
    }
    await workbench.appendResolutionEvent(event, resolutionsDir);
    countResolutionEvent(sessionCounts, event.eventType, action);
    await Deno.stdout.write(
      encoder.encode(
        event.eventType === "defer_review_item" ? "Saved defer.\n" : "Saved resolution.\n",
      ),
    );
    stickyPacketId = packet?.packetId;
  }
}

function emptySessionCounts(): ReviewSessionCounts {
  return {
    accepted: 0,
    rejected: 0,
    normalized: 0,
    edited: 0,
    skipped: 0,
    deferred: 0,
  };
}

function countResolutionEvent(
  counts: ReviewSessionCounts,
  eventType: ResolutionEventInput["eventType"],
  action: string,
): void {
  if (eventType === "defer_review_item") {
    counts.deferred += 1;
    return;
  }
  if (eventType.startsWith("reject_")) {
    counts.rejected += 1;
    return;
  }
  if (action === "n") {
    counts.normalized += 1;
    return;
  }
  if (action === "e" || eventType === "merge_entity_candidates") {
    counts.edited += 1;
    return;
  }
  if (eventType.startsWith("accept_")) {
    counts.accepted += 1;
  }
}

function printReviewSessionSummary(
  workbench: Pick<InteractiveReviewWorkbench, "db" | "listReviewItems">,
  counts: ReviewSessionCounts,
  filters: ReviewItemFilters,
): void {
  const open = workbench.listReviewItems({ ...filters, status: "open", limit: undefined }).length;
  const deferred = workbench.listReviewItems({ ...filters, status: "deferred", limit: undefined })
    .length;
  const blocked = shouldFilterInteractiveItems({ ...filters, status: undefined })
    ? projectOpenHumanDecisionWork(workbench as InteractiveReviewWorkbench, {
      ...filters,
      status: "open",
    }).summary.filteredBlockedDiagnosticCount
    : 0;
  console.log("Review session summary:");
  console.log(`  accepted: ${counts.accepted}`);
  console.log(`  rejected: ${counts.rejected}`);
  console.log(`  normalized: ${counts.normalized}`);
  console.log(`  edited: ${counts.edited}`);
  console.log(`  deferred: ${counts.deferred}`);
  console.log(`  skipped: ${counts.skipped}`);
  console.log("");
  console.log("Remaining:");
  console.log(`  open: ${open}`);
  console.log(`  deferred: ${deferred}`);
  console.log(`  blocked: ${blocked}`);
  console.log("");
  console.log("Next:");
  console.log(`  ${renderResumeCommand(filters)}`);
}

interface InteractiveReviewSelection {
  packet?: ReviewPacketRecord;
  item: ReviewItemRecord;
  decision?: ReviewPacketPriorityDecision;
}

interface InteractiveReviewSnapshot {
  items: ReviewItemRecord[];
  browseOnlyItemCount: number;
  itemsByReviewItemId: Map<string, ReviewItemRecord>;
  packets: ReviewPacketRecord[];
  rankedPackets: ReviewPacketRecord[];
  decisions: UnresolvedDecisionNode[];
  decisionsByReviewItemId: Map<string, ReviewPacketPriorityDecision>;
  blockedDiagnosticCount: number;
  diagnostics: UnresolvedDiagnosticNode[];
}

function buildInteractiveReviewSnapshot(
  workbench: Pick<InteractiveReviewWorkbench, "db" | "dbPath" | "listReviewItems">,
  filters: ReviewItemFilters,
): InteractiveReviewSnapshot {
  if (shouldFilterInteractiveItems(filters)) {
    const projection = projectOpenHumanDecisionWork(workbench, filters);
    const items = projection.items.map((item) => item.reviewItem);
    const itemsByReviewItemId = new Map(items.map((item) => [item.reviewItemId, item]));
    const packets = reviewPacketsFromItems(workbench, items);
    const decisions = projection.items.map((item) => item.decision);
    const decisionsByReviewItemId = reviewPacketPriorityDecisionMap(decisions);
    const rankedPackets = rankReviewPacketsByPriority(packets, decisionsByReviewItemId);
    return {
      items,
      browseOnlyItemCount: projection.summary.filteredBrowseOnlyOpenReviewItemCount,
      itemsByReviewItemId,
      packets,
      rankedPackets,
      decisions,
      decisionsByReviewItemId,
      blockedDiagnosticCount: projection.summary.filteredBlockedDiagnosticCount,
      diagnostics: projection.diagnostics,
    };
  }

  const allItems = workbench.listReviewItems({ ...filters, limit: undefined });
  const items = allItems;
  const browseOnlyItemCount = allItems.length - items.length;
  const itemsByReviewItemId = new Map(items.map((item) => [item.reviewItemId, item]));
  const packets = reviewPacketsFromItems(workbench, items);
  const graph = buildUnresolvedWorkGraph(workbench);
  const decisions = graph.decisions.filter((decision) =>
    itemsByReviewItemId.has(decision.reviewItemId)
  );
  const decisionsByReviewItemId = reviewPacketPriorityDecisionMap(decisions);
  const rankedPackets = rankReviewPacketsByPriority(packets, decisionsByReviewItemId);
  return {
    items,
    browseOnlyItemCount,
    itemsByReviewItemId,
    packets,
    rankedPackets,
    decisions,
    decisionsByReviewItemId,
    blockedDiagnosticCount: 0,
    diagnostics: [],
  };
}

function shouldFilterInteractiveItems(filters: ReviewItemFilters): boolean {
  return filters.status === undefined || filters.status === "open";
}

function nextInteractiveReviewSelection(
  snapshot: InteractiveReviewSnapshot,
  stickyPacketId?: string,
): InteractiveReviewSelection | undefined {
  const packet = snapshot.packets.find((candidate) => candidate.packetId === stickyPacketId) ??
    snapshot.rankedPackets.at(0);
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
    .filter((candidate): candidate is ReviewPacketPriorityDecision => Boolean(candidate))
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

function renderDecisionImpact(decision: ReviewPacketPriorityDecision): string {
  const noun = decision.downstreamBlockedCount === 1 ? "relationship" : "relationships";
  return `Decision impact: unblocks ${decision.downstreamBlockedCount} blocked ${noun}.`;
}

function renderBlockedDiagnosticsOnlyMessage(
  snapshot: Pick<InteractiveReviewSnapshot, "blockedDiagnosticCount" | "diagnostics">,
): string {
  const noun = snapshot.blockedDiagnosticCount === 1 ? "item" : "items";
  const verb = snapshot.blockedDiagnosticCount === 1 ? "remains" : "remain";
  const lines = [
    `No direct review decisions remain. ${snapshot.blockedDiagnosticCount} blocked reconciliation ${noun} ${verb}.`,
  ];
  const first = snapshot.diagnostics[0];
  if (first) {
    lines.push(
      `First blocked: ${first.rawValue ?? first.subjectId} [${
        first.relationshipType ?? first.subjectType
      } from ${first.sourceId}]`,
    );
  }
  lines.push(`Inspect blocked dependencies with ${dcCommand("audit")}.`);
  return lines.join("\n");
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
  const impact = reviewPacketPriorityScore(packet, snapshot.decisionsByReviewItemId);
  const scope = packetInboxScope(packet);
  const prefix = index === 0 ? `${index + 1}. [recommended]` : `${index + 1}.`;
  const impactText = impact > 0 ? `; unblocks ${impact}` : "";
  return `${prefix} ${choice.title} - ${scope} [default ${choice.defaultAction}; packet ${packet.openCount} open${impactText}]`;
}

function packetInboxScope(packet: ReviewPacketRecord): string {
  if (packet.relationshipType) return `${packet.sourceId} ${packet.relationshipType}`;
  if (packet.itemType === "legal_ref") {
    return packet.refType && packet.refType !== "unknown"
      ? `${packet.sourceId} ${humanizeToken(packet.refType)} legal ref`
      : `${packet.sourceId} legal reference`;
  }
  if (packet.itemType === "source_status") return `${packet.sourceId} source note`;
  return `${packet.sourceId} ${humanizeToken(packet.itemType)}`;
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
        title: packetInboxTitle(store, packet, leadItem),
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
  const impact = reviewPacketPriorityScore(packet, snapshot.decisionsByReviewItemId);
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
    .filter((candidate): candidate is ReviewPacketPriorityDecision => Boolean(candidate))
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

function packetInboxTitle(
  store: Pick<WorkbenchStore, "db">,
  packet: ReviewPacketRecord,
  leadItem: ReviewItemRecord,
): string {
  const deferredTitle = deferredRelationshipPacketTitle(store, packet);
  if (deferredTitle) return deferredTitle;
  return reviewItemTitle(store, leadItem);
}

function deferredRelationshipPacketTitle(
  store: Pick<WorkbenchStore, "db">,
  packet: ReviewPacketRecord,
): string | undefined {
  if (packet.itemType !== "relationship_candidate" || packet.defaultAction !== "defer") {
    return undefined;
  }
  if (!packet.toEntityRef) return undefined;
  const targetName = endpointStatusMap(store, [packet.toEntityRef]).get(packet.toEntityRef)?.name ??
    humanizeToken(packet.toEntityRef.replace(/^dc\./, "").replace(/^legal\./, ""));
  if (packet.whyDeferred?.startsWith("Oversight text uses exclusion")) {
    return `${targetName} exclusion oversight`;
  }
  if (packet.whyDeferred?.includes('parent branch as "Other"')) {
    return `${targetName} branch relationships`;
  }
  return targetName;
}

function renderResumeCommand(filters: ReviewItemFilters): string {
  return renderReviewCommand(filters);
}

function renderReviewListCommand(filters: ReviewItemFilters): string {
  return renderReviewCommand(filters, { browseSubcommand: "list" });
}

function renderReviewPacketsCommand(filters: ReviewItemFilters): string {
  return renderReviewCommand(filters, { browseSubcommand: "packets" });
}

export function renderReviewItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  options: RenderReviewItemOptions = {},
): string {
  const subject = reviewSubject(store, item);
  const context = reviewSubjectContext(store, item, subject);
  const omittedDetailKeys = specialOmittedDetailKeys(item, context.omittedDetailKeys);
  if (options.raw) {
    return [
      "Raw details:",
      `ids: subject=${item.subjectId}, review=${item.reviewItemId}`,
      `item_type: ${item.itemType}`,
      `status: ${item.status}`,
      `default_action: ${item.defaultAction}`,
      `reason: ${item.reason}`,
      `details_json: ${JSON.stringify(item.details, null, 2)}`,
      ...renderEvidenceBlock(reviewEvidence(store, item)),
    ].filter((line): line is string => Boolean(line)).join("\n");
  }
  if (item.itemType === "legal_ref") {
    return renderCompactLegalCard(store, item, subject, context, options);
  }
  if (item.itemType === "relationship_candidate") {
    return renderCompactRelationshipCard(store, item, subject, context, options);
  }
  if (item.itemType === "entity_candidate") {
    return renderCompactEntityCard(store, item, subject, context, options);
  }
  return [
    `Review: ${context.title}`,
    [humanizeToken(item.itemType), context.infoLabel, item.status].filter(Boolean).join(" | "),
    context.sourceLine,
    `reason: ${item.reason}`,
    renderDecisionQuestion(item),
    ...renderIdentityContext(item),
    renderWhyDeferred(item),
    `default: ${renderDefaultAction(item)}`,
    renderDecisionOutcome(item),
    `actions: ${availableActionLabels(item).join(", ")}`,
    `ids: subject=${item.subjectId}, review=${item.reviewItemId}`,
    ...renderRelationshipBlock(item, subject, context.relationshipEndpoints),
    ...renderLegalSuggestionBlock(item),
    ...renderDetailsBlock(item.details, omittedDetailKeys),
    ...renderEvidenceBlock(reviewEvidence(store, item)),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function renderCardHeader(
  options: RenderReviewItemOptions,
  kind: string,
  label?: string,
): string {
  const prefix = options.position && options.total ? `[${options.position}/${options.total}] ` : "";
  return `${prefix}${kind}${label ? ` · ${label}` : ""}`;
}

function renderCompactLegalCard(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
  context: ReviewSubjectContext,
  options: RenderReviewItemOptions,
): string {
  const citation = subject?.itemType === "legal_ref" ? subject.citationText : context.title;
  const refType = subject?.itemType === "legal_ref"
    ? humanizeToken(subject.refType)
    : context.infoLabel;
  const normalized = stringValue(item.details.normalizedCitation) ?? "unknown";
  return [
    renderCardHeader(options, "legal citation", refType),
    "",
    "Subject:",
    `  ${citation}`,
    "",
    "Source claim:",
    `  ${sourceClaimLine(store, item, subject)}`,
    "",
    "Current parse:",
    `  ${normalized}`,
    ...renderIssueLines(item),
    "",
    "Release effect:",
    "  excluded until accepted or normalized",
    "",
    "Actions:",
    ...availableActionLabels(item).map((label) => `  ${label}`),
    ...renderLegalSuggestionBlock(item),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function renderCompactRelationshipCard(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
  context: ReviewSubjectContext,
  options: RenderReviewItemOptions,
): string {
  const relationship = subject?.itemType === "relationship_candidate" ? subject : undefined;
  const endpoints = context.relationshipEndpoints;
  return [
    renderCardHeader(options, "relationship", shortIssueLabel(item)),
    "",
    "From:",
    `  ${
      endpoints ? endpointTitle(endpoints.from) : relationship?.fromEntityRef ?? item.subjectId
    }`,
    "",
    "Relationship:",
    `  ${relationship?.relationshipType ?? context.infoLabel ?? "unknown"}`,
    "",
    "To:",
    `  ${endpoints ? endpointTitle(endpoints.to) : relationship?.toEntityRef ?? "unknown"}`,
    "",
    "Source claim:",
    `  ${sourceClaimLine(store, item, subject)}`,
    "",
    "Issue:",
    `  ${shortIssueLabel(item)}`,
    "",
    "Release effect:",
    "  relationship excluded until accepted",
    "",
    "Actions:",
    ...availableActionLabels(item).map((label) => `  ${label}`),
  ].join("\n");
}

function renderCompactEntityCard(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
  context: ReviewSubjectContext,
  options: RenderReviewItemOptions,
): string {
  return [
    renderCardHeader(options, "entity", context.infoLabel),
    "",
    "Subject:",
    `  ${context.title}`,
    "",
    "Source claim:",
    `  ${sourceClaimLine(store, item, subject)}`,
    "",
    "Issue:",
    `  ${shortIssueLabel(item)}`,
    "",
    "Release effect:",
    `  ${entityReleaseEffect(item)}`,
    "",
    "Actions:",
    ...availableActionLabels(item).map((label) => `  ${label}`),
  ].join("\n");
}

function subjectSourceClaim(
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
  evidence: ReviewEvidenceRow[],
): string {
  const firstEvidence = evidence[0];
  if (subject?.itemType === "relationship_candidate") {
    const value = subject.rawValue ?? firstEvidence?.observedValue;
    const field = firstEvidence?.fieldPath ?? "source value";
    return `${subject.source.sourceId} ${field} = ${formatClaimValue(value ?? "unknown")}`;
  }
  if (subject?.itemType === "legal_ref") {
    const value = subject.citationText;
    const field = firstEvidence?.fieldPath ?? "citation";
    return `${subject.source.sourceId} ${field} = ${formatClaimValue(value)}`;
  }
  if (subject?.itemType === "entity_candidate") {
    const value = firstEvidence?.observedValue ?? subject.name;
    const field = firstEvidence?.fieldPath ?? "name";
    return `${subject.source.sourceId} ${field} = ${formatClaimValue(value)}`;
  }
  const value = stringValue(item.details.rawValue) ?? stringValue(item.details.name) ??
    stringValue(item.details.citationText);
  return value ? formatClaimValue(value) : item.reason;
}

function formatClaimValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : formatDetailValue(value);
}

function renderIssueLines(item: ReviewItemRecord): string[] {
  return [
    "",
    "Issue:",
    `  ${shortIssueLabel(item)}`,
  ];
}

function shortIssueLabel(item: ReviewItemRecord): string {
  if (typeof item.details.issue === "string") return humanizeToken(item.details.issue);
  if (typeof item.details.whyDeferred === "string") return item.details.whyDeferred;
  if (item.itemType === "relationship_candidate") {
    if (item.defaultAction === "defer") return "endpoint ambiguity";
    return "relationship needs review";
  }
  if (item.itemType === "legal_ref") {
    const refType = stringValue(item.details.refType);
    if (!refType || refType === "unknown") return "unknown citation";
    return "legal citation needs review";
  }
  if (item.itemType === "entity_candidate") {
    if (
      typeof item.details.existingKind === "string" &&
      typeof item.details.candidateKind === "string"
    ) {
      return "entity conflict";
    }
    return "entity candidate needs review";
  }
  return item.reason;
}

function entityReleaseEffect(item: ReviewItemRecord): string {
  if (item.defaultAction === "defer") return "excluded until accepted, edited, or rejected";
  return "accepted entity enters the release; rejected or deferred stays out";
}

function sourceClaimLine(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
): string {
  return subjectSourceClaim(item, subject, reviewEvidence(store, item));
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
    `[${item.status} ${reviewItemWorkKind(item)}] ${context.title}`,
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
  workbench: InteractiveReviewWorkbench,
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
  workbench: Pick<InteractiveReviewWorkbench, "db" | "listReviewItems">,
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

function renderDecisionOutcome(item: ReviewItemRecord): string | undefined {
  if (item.itemType === "entity_candidate") {
    if (
      typeof item.details.identityQuestion === "string" &&
      typeof item.details.existingEntityId === "string" &&
      typeof item.details.candidateKind === "string"
    ) {
      return `impact: decide whether this ${item.details.candidateKind} source row is a distinct public body before attaching it to existing agency ${item.details.existingEntityId}.`;
    }
    if (
      typeof item.details.existingEntityId === "string" &&
      typeof item.details.existingKind === "string" &&
      typeof item.details.candidateKind === "string"
    ) {
      return `impact: accept attaches this ${item.details.candidateKind} candidate to existing ${item.details.existingKind} ${item.details.existingEntityId}; defer keeps the source conflict out of the release until decided.`;
    }
    return "impact: accept promotes this candidate into canonical entities; reject or defer keeps it out of the release for now.";
  }
  if (item.itemType === "relationship_candidate") {
    return "impact: accept writes this directed relationship; reject drops it; defer keeps it out of the release for now.";
  }
  if (item.itemType === "legal_ref") {
    return "impact: accept keeps this citation as source-backed legal context; reject drops it; defer keeps it pending.";
  }
  if (item.itemType === "source_status") {
    return "impact: defer keeps this source unresolved until the source issue is handled.";
  }
  return undefined;
}

function renderDecisionQuestion(item: ReviewItemRecord): string | undefined {
  if (typeof item.details.identityQuestion === "string") {
    return `question: ${item.details.identityQuestion}`;
  }
  if (item.itemType === "entity_candidate") {
    return "question: Should this source entity candidate be accepted, merged, rejected, or deferred?";
  }
  if (item.itemType === "relationship_candidate") {
    return "question: Should this directed relationship be accepted, edited, rejected, or deferred?";
  }
  if (item.itemType === "legal_ref") {
    return "question: Should this legal reference be accepted, normalized, rejected, or deferred?";
  }
  if (item.itemType === "source_status") {
    return "question: Should this source issue stay deferred while the source is fixed?";
  }
  if (item.itemType === "placeholder_entity") {
    return "question: Should this placeholder entity be resolved before relying on dependent facts?";
  }
  return undefined;
}

function renderIdentityContext(item: ReviewItemRecord): string[] {
  if (typeof item.details.identityQuestion !== "string") return [];
  return [
    detailLine("sourceGoverningAgency", item.details.sourceGoverningAgency),
    detailLine("sourceShortName", item.details.sourceShortName),
    detailLine("sourceUrl", item.details.sourceUrl),
  ].filter((line): line is string => line !== undefined);
}

function detailLine(label: string, value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? `${label}: ${value}` : undefined;
}

function renderWhyDeferred(item: ReviewItemRecord): string | undefined {
  return typeof item.details.whyDeferred === "string"
    ? `why deferred: ${item.details.whyDeferred}`
    : undefined;
}

function specialOmittedDetailKeys(item: ReviewItemRecord, omittedKeys: string[]): string[] {
  return [
    ...omittedKeys,
    ...(typeof item.details.whyDeferred === "string" ? ["whyDeferred"] : []),
    ...(typeof item.details.identityQuestion === "string" ? ["identityQuestion"] : []),
    ...(Array.isArray(item.details.suggestions) ? ["suggestions"] : []),
  ];
}

function actionPrompt(item: ReviewItemRecord): string {
  const keys = availableActionKeys(item).map((key) => key === "" ? "Enter" : key);
  return keys.join("/");
}

function availableActionLabels(item: ReviewItemRecord): string[] {
  return availableActionKeys(item).map((key) => {
    if (key === "") return "Enter skip";
    if (key === "s") return "s skip";
    if (key === "a") return "a accept";
    if (key === "r") return "r reject";
    if (key === "m") return "m merge";
    if (key === "e") return "e edit";
    if (key === "n") return "n normalize";
    if (key === "d") return "d defer";
    if (key === "v") return "v raw details";
    if (key === "q") return "q quit";
    return key;
  });
}

function sentenceList(values: string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function availableActionKeys(item: ReviewItemRecord): string[] {
  if (item.itemType === "entity_candidate") return ["", "s", "a", "r", "m", "d", "v", "q"];
  if (item.itemType === "relationship_candidate") return ["", "s", "a", "e", "r", "d", "v", "q"];
  if (item.itemType === "legal_ref") return ["", "s", "a", "n", "r", "d", "v", "q"];
  return ["", "s", "d", "v", "q"];
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

function renderLegalSuggestionBlock(item: ReviewItemRecord): string[] {
  if (item.itemType !== "legal_ref") return [];
  if (!Array.isArray(item.details.suggestions) || item.details.suggestions.length === 0) {
    return [];
  }
  const lines = item.details.suggestions.flatMap((suggestion) => {
    if (!isRecord(suggestion)) return [];
    const normalizedCitation = stringValue(suggestion.normalizedCitation);
    if (!normalizedCitation) return [];
    const relatedCitation = stringValue(suggestion.relatedCitation);
    const title = stringValue(suggestion.title);
    const url = stringValue(suggestion.url);
    const source = stringValue(suggestion.source);
    return [
      `- ${normalizedCitation}${relatedCitation ? ` via ${relatedCitation}` : ""}${
        source ? ` (${source})` : ""
      }`,
      title ? `  title: ${title}` : undefined,
      url ? `  url: ${url}` : undefined,
    ].filter((line): line is string => line !== undefined);
  });
  return lines.length > 0 ? ["suggestions:", ...lines] : [];
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
    ...evidence.slice(0, 8).flatMap((row) => {
      const lines = [`- ${row.sourceId}: ${row.fieldPath} <- ${row.observedValue}`];
      if (row.fetchedUrl) lines.push(`  url: ${row.fetchedUrl}`);
      lines.push(`  artifact: ${row.artifactPath}`);
      return lines;
    }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
