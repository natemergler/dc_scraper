import type { EntityView, ResolutionEventInput, ReviewItemRecord } from "../domain.ts";
import { type Workbench } from "../workbench.ts";
import { queryAll, queryOne } from "./db.ts";
import { canBatchAcceptReviewItem, type ReviewItemFilters } from "./review.ts";
import type { WorkbenchStore } from "./store.ts";

interface ReviewEvidenceRow {
  fieldPath: string;
  observedValue: string;
  sourceId: string;
  artifactPath: string;
}

interface RelationshipReviewRow {
  relationshipType: string;
  fromEntityRef: string;
  toEntityRef: string;
  rawValue?: string | null;
  sourceId: string;
  itemTitle: string;
}

interface EndpointStatus {
  entityId: string;
  status: string;
  name?: string;
  note?: string;
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
    const items = workbench.listReviewItems(activeFilters);
    const item = items.at(0);
    if (!item) {
      console.log("No review items remain.");
      return;
    }
    console.log(renderReviewItem(workbench, item));
    const promptedAction = await promptLine(`Action [${actionPrompt(item)}]: `);
    if (promptedAction === undefined || promptedAction === "q") {
      console.log(
        `Review stopped. ${items.length} item(s) remain. Resume with ${
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
  const parts = ["dc", "review"];
  if (filters.mode && ["entities", "relationships", "legal", "sources"].includes(filters.mode)) {
    parts.push(filters.mode);
  }
  if (filters.status && filters.status !== "open") {
    parts.push("--status", quoteShellArg(filters.status));
  }
  if (filters.type) {
    parts.push("--type", quoteShellArg(filters.type));
  }
  if (filters.subjectPrefix) {
    parts.push("--subject-prefix", quoteShellArg(filters.subjectPrefix));
  }
  if (filters.relationshipType) {
    parts.push("--relationship-type", quoteShellArg(filters.relationshipType));
  }
  if (filters.rawValue) {
    parts.push("--raw-value", quoteShellArg(filters.rawValue));
  }
  if (filters.rawValueContains) {
    parts.push("--raw-value-contains", quoteShellArg(filters.rawValueContains));
  }
  if (filters.refType) {
    parts.push("--ref-type", quoteShellArg(filters.refType));
  }
  return parts.join(" ");
}

function quoteShellArg(value: string): string {
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderReviewItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string {
  return [
    `Review item: ${item.reviewItemId}`,
    "What needs review",
    `- type: ${item.itemType}`,
    `- subject: ${item.subjectId}`,
    `- status: ${item.status}`,
    "Why this matters",
    item.reason,
    `Default action: ${renderDefaultAction(item)}`,
    `Available actions: ${availableActionLabels(item).join(", ")}`,
    ...renderRelationshipBlock(store, item),
    ...renderDetailsBlock(item.details),
    ...renderEvidenceBlock(reviewEvidence(store, item)),
  ].join("\n");
}

export function renderReviewItemSummary(item: ReviewItemRecord): string {
  const details = compactDetails(item.details);
  return [
    `[${item.status}] ${item.itemType} ${item.subjectId}`,
    `reason: ${item.reason}`,
    `default: ${item.defaultAction}`,
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
    await workbench.appendResolutionEvent(batchAcceptEvent(item), resolutionsDir);
  }
  console.log(`Accepted ${accepted.length} safe review item(s).`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} item(s) that were not safe to auto-accept.`);
  }
}

export async function runBatchDefer(
  workbench: Pick<Workbench, "listReviewItems" | "appendResolutionEvent">,
  filters: ReviewItemFilters,
  resolutionsDir: string,
): Promise<void> {
  if (!isScopedBatchDefer(filters)) {
    throw new Error(
      "Batch defer requires --mode, --subject-prefix, and at least one narrowing filter.",
    );
  }
  const items = workbench.listReviewItems({ ...filters, status: "open" });
  for (const item of items) {
    await workbench.appendResolutionEvent(
      { eventType: "defer_review_item", subjectId: item.reviewItemId, payload: {} },
      resolutionsDir,
    );
  }
  console.log(`Deferred ${items.length} review item(s).`);
}

function isScopedBatchDefer(filters: ReviewItemFilters): boolean {
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

export function renderEntityView(view: EntityView): string {
  const lines = [
    `${view.name} (${view.kind})`,
    `id: ${view.entityId}`,
    `review: ${view.reviewStatus}`,
  ];
  if (view.branch) lines.push(`branch: ${view.branch}`);
  if (view.cluster) lines.push(`cluster: ${view.cluster}`);
  if (view.officialUrl) lines.push(`official_url: ${view.officialUrl}`);
  if (view.isPlaceholder) {
    lines.push(`placeholder: yes${view.placeholderReason ? ` (${view.placeholderReason})` : ""}`);
  }
  lines.push("evidence:");
  for (const evidence of view.evidence.slice(0, 10)) {
    lines.push(
      `- ${evidence.fieldPath} <- ${evidence.observedValue} [${evidence.sourceId} @ ${evidence.artifactPath}]`,
    );
  }
  lines.push("outgoing:");
  for (const relationship of view.outgoing) {
    lines.push(
      `- ${relationship.relationshipType} -> ${relationship.targetEntityId} (${relationship.targetName})`,
    );
  }
  lines.push("incoming:");
  for (const relationship of view.incoming) {
    lines.push(
      `- ${relationship.relationshipType} <- ${relationship.sourceEntityId} (${relationship.sourceName})`,
    );
  }
  if (view.legalRefs.length > 0) {
    lines.push("legal_refs:");
    for (const legalRef of view.legalRefs) {
      lines.push(`- ${legalRef.refType}: ${legalRef.normalizedCitation ?? legalRef.citationText}`);
    }
  }
  if (view.reviewItems.length > 0) {
    lines.push("open_review:");
    for (const item of view.reviewItems) {
      lines.push(`- ${item.itemType}: ${item.reason}`);
    }
  }
  return lines.join("\n");
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

function renderDetailsBlock(details: Record<string, unknown>): string[] {
  const entries = Object.entries(details).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return ["details: none"];
  return [
    "details:",
    ...entries.map(([key, value]) => `- ${key}: ${formatDetailValue(value)}`),
  ];
}

function renderRelationshipBlock(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string[] {
  if (item.itemType !== "relationship_candidate") return [];
  const relationship = relationshipReviewRow(store, item.subjectId);
  if (!relationship) return [];
  const from = endpointStatus(store, relationship.fromEntityRef);
  const to = endpointStatus(store, relationship.toEntityRef);
  return [
    "relationship:",
    `- type: ${relationship.relationshipType}`,
    `- family: ${relationship.relationshipType} -> ${relationship.toEntityRef}`,
    `- from: ${renderEndpointStatus(from)}`,
    `- to: ${renderEndpointStatus(to)}`,
    `- source: ${relationship.sourceId} / ${relationship.itemTitle}`,
    relationship.rawValue ? `- raw: ${relationship.rawValue}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function relationshipReviewRow(
  store: Pick<WorkbenchStore, "db">,
  relationshipCandidateId: string,
): RelationshipReviewRow | undefined {
  return queryOne<RelationshipReviewRow>(
    store.db,
    `select relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.from_entity_ref as fromEntityRef,
            relationship_candidates.to_entity_ref as toEntityRef,
            relationship_candidates.raw_value as rawValue,
            source_items.source_id as sourceId,
            source_items.title as itemTitle
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     where relationship_candidates.relationship_candidate_id = ?`,
    [relationshipCandidateId],
  );
}

function endpointStatus(store: Pick<WorkbenchStore, "db">, entityId: string): EndpointStatus {
  const canonical = queryOne<{ name: string; reviewStatus: string; isPlaceholder: number }>(
    store.db,
    "select name, review_status as reviewStatus, is_placeholder as isPlaceholder from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (canonical) {
    return {
      entityId,
      name: canonical.name,
      status: canonical.isPlaceholder ? "placeholder" : canonical.reviewStatus,
      note: canonical.isPlaceholder ? "review placeholder before relying on this edge" : undefined,
    };
  }
  const candidate = queryOne<{ candidateId: string; name: string; reviewStatus: string }>(
    store.db,
    `select candidate_id as candidateId,
            name,
            review_status as reviewStatus
     from entity_candidates
     where proposed_entity_id = ?
     order by
       case review_status when 'accepted' then 0 when 'pending' then 1 else 2 end,
       coalesce(confidence, 0) desc,
       candidate_id
     limit 1`,
    [entityId],
  );
  if (candidate) {
    return {
      entityId,
      name: candidate.name,
      status: `candidate ${candidate.reviewStatus}`,
      note: candidate.reviewStatus === "pending"
        ? `accept entity candidate ${candidate.candidateId} first when possible`
        : undefined,
    };
  }
  return {
    entityId,
    status: "missing",
    note: "accepting will create a placeholder entity",
  };
}

function renderEndpointStatus(endpoint: EndpointStatus): string {
  const name = endpoint.name ? ` ${JSON.stringify(endpoint.name)}` : "";
  const note = endpoint.note ? `; ${endpoint.note}` : "";
  return `${endpoint.entityId}${name} (${endpoint.status}${note})`;
}

function renderEvidenceBlock(evidence: ReviewEvidenceRow[]): string[] {
  if (evidence.length === 0) return ["evidence: none"];
  return [
    "evidence:",
    ...evidence.slice(0, 8).flatMap((row) => [
      `- ${row.fieldPath} <- ${row.observedValue}`,
      `  source: ${row.sourceId} @ ${row.artifactPath}`,
    ]),
  ];
}

function reviewEvidence(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): ReviewEvidenceRow[] {
  if (item.itemType === "entity_candidate") {
    return queryAll<ReviewEvidenceRow>(
      store.db,
      `select field_path as fieldPath,
              observed_value as observedValue,
              source_id as sourceId,
              artifact_path as artifactPath
       from entity_candidate_evidence
       where candidate_id = ?
       order by field_path`,
      [item.subjectId],
    );
  }
  if (item.itemType === "relationship_candidate") {
    return queryAll<ReviewEvidenceRow>(
      store.db,
      `select field_path as fieldPath,
              observed_value as observedValue,
              source_id as sourceId,
              artifact_path as artifactPath
       from relationship_candidate_evidence
       where relationship_candidate_id = ?
       order by field_path`,
      [item.subjectId],
    );
  }
  if (item.itemType === "legal_ref") {
    return queryAll<ReviewEvidenceRow>(
      store.db,
      `select field_path as fieldPath,
              observed_value as observedValue,
              source_id as sourceId,
              artifact_path as artifactPath
       from legal_ref_evidence
       where legal_ref_id = ?
       order by field_path`,
      [item.subjectId],
    );
  }
  return [];
}

function compactDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}=${formatDetailValue(value)}`)
    .join(" ");
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
