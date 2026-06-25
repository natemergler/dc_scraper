import { assertEquals } from "@std/assert";

import {
  dcAffiliatedWithRelation,
  dcAuthorizedByRelation,
  dcChairsRelation,
  dcContainsRelation,
  dcGovernsRelation,
  dcHoldsRelation,
  dcMemberOfRelation,
  dcPartOfRelation,
  dcPublicRelationVerb,
  dcRawRelationVerb,
  dcRelationDescription,
  dcRelationSemantics,
  dcReportsToRelation,
  dcRepresentsRelation,
} from "../../../src/jurisdictions/dc/kinds/relation.ts";

Deno.test("DC relation semantics describe every registered relation kind", () => {
  const registeredKinds = [
    dcAffiliatedWithRelation.kind,
    dcAuthorizedByRelation.kind,
    dcChairsRelation.kind,
    dcContainsRelation.kind,
    dcGovernsRelation.kind,
    dcHoldsRelation.kind,
    dcMemberOfRelation.kind,
    dcPartOfRelation.kind,
    dcReportsToRelation.kind,
    dcRepresentsRelation.kind,
  ].sort();
  const semanticKinds = dcRelationSemantics.map((semantics) => semantics.kind).sort();

  assertEquals(new Set(semanticKinds).size, semanticKinds.length);
  for (const kind of registeredKinds) {
    assertEquals(typeof dcRelationDescription(kind), "string");
  }
});

Deno.test("DC relation semantics keep public projection verbs explicit", () => {
  assertEquals(dcRawRelationVerb("dc.relation:governs"), "governs");
  assertEquals(
    dcPublicRelationVerb({
      relationKind: "dc.relation:governs",
      fromKind: "dc.board",
      toKind: "dc.agency",
    }),
    "administered_by",
  );
  assertEquals(
    dcPublicRelationVerb({
      relationKind: "dc.relation:governs",
      fromKind: "dc.agency",
      toKind: "dc.board",
    }),
    undefined,
  );
  assertEquals(
    dcPublicRelationVerb({
      relationKind: "dc.relation:authorized_by",
      fromKind: "dc.board",
      toKind: "dc.legal_authority",
    }),
    "authorized_by",
  );
});

Deno.test("DC future relation descriptions do not imply public projection support", () => {
  assertEquals(
    dcRelationDescription("dc.relation:appoints"),
    "Only emitted when an explicit source supports an appointing relation; this release does not infer it from membership text.",
  );
  assertEquals(
    dcPublicRelationVerb({
      relationKind: "dc.relation:appoints",
      fromKind: "dc.board",
      toKind: "dc.agency",
    }),
    undefined,
  );
});
