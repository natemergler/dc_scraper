import type { EntityView, ResolutionEventInput, ReviewItemRecord } from "../domain.ts";
import { type Workbench } from "../workbench.ts";

export async function runInteractiveReview(
  workbench: Pick<Workbench, "nextReviewItem" | "appendResolutionEvent">,
  mode: string | undefined,
  resolutionsDir: string,
): Promise<void> {
  const encoder = new TextEncoder();
  while (true) {
    const item = workbench.nextReviewItem(mode);
    if (!item) {
      console.log("No review items remain.");
      return;
    }
    console.log(renderReviewItem(item));
    const action = await promptLine("Action [a/r/m/d/q/e]: ");
    if (!action || action === "q") {
      console.log("Review stopped without corrupting state.");
      return;
    }
    const event = await actionToEvent(item, action);
    if (!event) continue;
    await workbench.appendResolutionEvent(event, resolutionsDir);
    await Deno.stdout.write(encoder.encode("Saved resolution.\n"));
  }
}

export function renderReviewItem(item: ReviewItemRecord): string {
  return [
    `Review item: ${item.reviewItemId}`,
    `type: ${item.itemType}`,
    `subject: ${item.subjectId}`,
    `status: ${item.status}`,
    `reason: ${item.reason}`,
    `default: ${item.defaultAction}`,
  ].join("\n");
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
      return {
        eventType: "accept_relationship_candidate",
        subjectId: item.subjectId,
        payload: { relationshipType },
      };
    }
    if (action === "r") {
      return { eventType: "reject_relationship_candidate", subjectId: item.subjectId, payload: {} };
    }
  }
  if (action === "d") {
    return { eventType: "defer_review_item", subjectId: item.reviewItemId, payload: {} };
  }
  return undefined;
}

async function promptLine(promptText: string): Promise<string> {
  await Deno.stdout.write(new TextEncoder().encode(promptText));
  while (!stdinBuffer.includes("\n")) {
    const buffer = new Uint8Array(1024);
    const read = await Deno.stdin.read(buffer);
    if (read === null) break;
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
