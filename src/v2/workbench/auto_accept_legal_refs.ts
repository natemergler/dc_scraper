import { nowIso } from "../domain.ts";
import { queryAll, run } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface AutoAcceptLegalRefRow {
  legalRefId: string;
  refType: string;
  normalizedCitation?: string | null;
  reviewStatus: string;
  reviewItemStatus: string;
  defaultAction: string;
  needsReview?: number | null;
  stalePriorDecision?: number | null;
}

export function autoAcceptSafeLegalRefs(store: WorkbenchStore): number {
  const legalRefs = queryAll<AutoAcceptLegalRefRow>(
    store.db,
    `select legal_refs.legal_ref_id as legalRefId,
            legal_refs.ref_type as refType,
            legal_refs.normalized_citation as normalizedCitation,
            legal_refs.review_status as reviewStatus,
            review_items.status as reviewItemStatus,
            review_items.default_action as defaultAction,
            json_extract(review_items.details_json, '$.needsReview') as needsReview,
            json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision
     from legal_refs
     join review_items
       on review_items.subject_id = legal_refs.legal_ref_id
      and review_items.item_type = 'legal_ref'
     where legal_refs.review_status = 'pending'`,
  );

  let acceptedCount = 0;
  for (const legalRef of legalRefs) {
    if (!isSafeToAutoAccept(legalRef)) continue;
    run(
      store.db,
      "update legal_refs set review_status = 'accepted' where legal_ref_id = ?",
      [legalRef.legalRefId],
    );
    run(
      store.db,
      "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'legal_ref'",
      [nowIso(), legalRef.legalRefId],
    );
    acceptedCount += 1;
  }

  return acceptedCount;
}

function isSafeToAutoAccept(legalRef: AutoAcceptLegalRefRow): boolean {
  return legalRef.reviewStatus === "pending" &&
    legalRef.reviewItemStatus === "open" &&
    legalRef.defaultAction === "accept" &&
    legalRef.refType !== "unknown" &&
    Boolean(legalRef.normalizedCitation) &&
    legalRef.needsReview !== 1 &&
    legalRef.stalePriorDecision !== 1;
}
