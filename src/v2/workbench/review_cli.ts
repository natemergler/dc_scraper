import type { ResolutionEventInput, ReviewItemRecord } from "../domain.ts";
import { type Workbench } from "../workbench.ts";
import { type EndpointStatus, endpointStatus } from "./endpoint_status.ts";
import { appendResolutionEvents } from "./resolution.ts";
import { reviewFilterArgs, reviewModeSubcommand } from "./review_command_args.ts";
import { listReviewPackets, renderReviewPacketHeader } from "./review_packets.ts";
import { canBatchAcceptReviewItem, type ReviewItemFilters } from "./review.ts";
import {
  reviewEvidence,
  type ReviewEvidenceRow,
  type ReviewSubject,
  reviewSubject,
} from "./review_subject.ts";
import type { WorkbenchStore } from "./store.ts";

interface ReviewSubjectContext {
  title: string;
  infoLabel?: string;
  sourceLine?: string;
  omittedDetailKeys: string[];
}

export async function runInteractiveReview(
  workbench: Pick<Workbench, "db" | "listReviewItems" | "appendResolutionEvent">,
  filters: ReviewItemFilters,
  resolutionsDir: string,
): Promise<void> {
  const encoder = new TextEncoder();
  const activeFilters: ReviewItemFilters = filters.status === undefined
    ? { ...filters, status: "open" }
    : filters;
  while (true) {
    const item = workbench.listReviewItems({ ...activeFilters, limit: 1 }).at(0);
    if (!item) {
      console.log("No review items remain.");
      return;
    }
    const packet = listReviewPackets(workbench, activeFilters).find((candidate) =>
      candidate.reviewItemIds.includes(item.reviewItemId)
    );
    if (packet && packet.count > 1) {
      console.log(renderReviewPacketHeader(packet));
      console.log("");
    }
    console.log(renderReviewItem(workbench, item));
    const promptedAction = await promptLine(`Action [${actionPrompt(item)}]: `);
    if (promptedAction === undefined || promptedAction === "q") {
      const remainingCount = workbench.listReviewItems(activeFilters).length;
      console.log(
        `Review stopped. ${remainingCount} item(s) remain. Resume with ${
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
  }
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
  return [
    `Review: ${context.title}`,
    [humanizeToken(item.itemType), context.infoLabel, item.status].filter(Boolean).join(" | "),
    context.sourceLine,
    `reason: ${item.reason}`,
    `default: ${renderDefaultAction(item)}`,
    `actions: ${availableActionLabels(item).join(", ")}`,
    `ids: subject=${item.subjectId}, review=${item.reviewItemId}`,
    ...renderRelationshipBlock(store, item, subject),
    ...renderDetailsBlock(item.details, context.omittedDetailKeys),
    ...renderEvidenceBlock(reviewEvidence(store, item)),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function renderReviewItemSummary(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string {
  const context = reviewSubjectContext(store, item, reviewSubject(store, item));
  const details = compactDetails(item.details, context.omittedDetailKeys);
  return [
    `[${item.status}] ${context.title}`,
    [humanizeToken(item.itemType), context.infoLabel, `default ${item.defaultAction}`].filter(
      Boolean,
    ).join(" | "),
    context.sourceLine,
    `reason: ${item.reason}`,
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
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  subject: ReviewSubject | undefined,
): string[] {
  if (item.itemType !== "relationship_candidate") return [];
  if (!subject || subject.itemType !== "relationship_candidate") return [];
  const relationship = subject;
  const from = endpointStatus(store, relationship.fromEntityRef);
  const to = endpointStatus(store, relationship.toEntityRef);
  return [
    "relationship:",
    `- type: ${relationship.relationshipType}`,
    `- from: ${renderEndpointStatus(from)}`,
    `- to: ${renderEndpointStatus(to)}`,
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
      const from = endpointStatus(store, relationship.fromEntityRef);
      const to = endpointStatus(store, relationship.toEntityRef);
      return {
        title: relationship.rawValue ?? `${endpointTitle(from)} -> ${endpointTitle(to)}`,
        infoLabel: humanizeToken(relationship.relationshipType),
        sourceLine: sourceLine(relationship.source),
        omittedDetailKeys: [],
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
