import type { RelationshipType } from "../domain.ts";

export function isLegalAuthorityRelationship(
  relationshipType: RelationshipType | string,
  toEntityRef: string,
): boolean {
  return relationshipType === "authorized_by" && toEntityRef.startsWith("legal.");
}
