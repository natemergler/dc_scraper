import { defineRelationKind } from "../../../core/kinds.ts";

export interface DcRelationSemantics {
  kind: string;
  description: string;
  publicVerb?: string;
  publicFromKinds?: readonly string[];
  publicToKinds?: readonly string[];
}

export const dcRelationSemantics = [
  {
    kind: "dc.relation:affiliated_with",
    description:
      "Source labels an administrative affiliation; consumers should inspect citations before treating it as authority.",
    publicVerb: "affiliated_with",
  },
  {
    kind: "dc.relation:governs",
    description:
      "Source names a governing or administering agency for a public body; projection labels safe agency/office targets as administered_by.",
    publicVerb: "administered_by",
    publicFromKinds: ["dc.board", "dc.commission", "dc.authority", "dc.council"],
    publicToKinds: ["dc.agency", "dc.office"],
  },
  {
    kind: "dc.relation:reports_to",
    description: "Source explicitly names a reporting parent for an agency or office.",
    publicVerb: "reports_to",
  },
  {
    kind: "dc.relation:authorized_by",
    description: "Entry cites an explicit supported legal locator as authority evidence.",
    publicVerb: "authorized_by",
  },
  {
    kind: "dc.relation:contains",
    description: "Source-backed containment between areas or structural units.",
    publicVerb: "contains",
  },
  {
    kind: "dc.relation:represents",
    description: "Source labels a person, position, or area as representing a ward or SMD.",
    publicVerb: "represents",
  },
  {
    kind: "dc.relation:holds",
    description: "Official source lists a person as holding an elected office.",
    publicVerb: "holds",
  },
  {
    kind: "dc.relation:chairs",
    description: "Council source lists a councilmember as committee chair.",
    publicVerb: "chairs",
  },
  {
    kind: "dc.relation:member_of",
    description: "Council source lists a councilmember as a committee member.",
    publicVerb: "member_of",
  },
  {
    kind: "dc.relation:part_of",
    description:
      "Source page or structure says one office, division, or institution is part of another.",
    publicVerb: "part_of",
  },
  {
    kind: "dc.relation:advises",
    description:
      "Only emitted when an explicit source supports an advisory relation; alpha does not infer it from names.",
  },
  {
    kind: "dc.relation:appoints",
    description:
      "Only emitted when an explicit source supports an appointing relation; alpha does not infer it from membership text.",
  },
  {
    kind: "dc.relation:elects",
    description:
      "Only emitted when an explicit source supports an election relation; alpha does not infer it from office labels.",
  },
  {
    kind: "dc.relation:established_by",
    description:
      "Only emitted when an explicit source supports establishment by a specific authority.",
  },
  {
    kind: "dc.relation:oversees",
    description:
      "Only emitted when an explicit source supports an oversight relation; alpha does not infer it from administration labels.",
  },
] as const satisfies readonly DcRelationSemantics[];

const dcRelationSemanticsByKind: ReadonlyMap<string, DcRelationSemantics> = new Map(
  dcRelationSemantics.map((semantics): [string, DcRelationSemantics] => [
    semantics.kind,
    semantics,
  ]),
);

export function dcRelationDescription(kind: string): string | undefined {
  return dcRelationSemanticsByKind.get(kind)?.description;
}

export function dcRawRelationVerb(kind: string): string {
  return kind.split(":").at(-1) ?? kind;
}

export function dcPublicRelationVerb(input: {
  relationKind: string;
  fromKind: string;
  toKind: string;
}): string | undefined {
  const semantics = dcRelationSemanticsByKind.get(input.relationKind);
  if (!semantics) {
    return undefined;
  }
  if (!semantics.publicVerb) {
    return undefined;
  }
  if (
    semantics.publicFromKinds &&
    !semantics.publicFromKinds.includes(input.fromKind)
  ) {
    return undefined;
  }
  if (
    semantics.publicToKinds &&
    !semantics.publicToKinds.includes(input.toKind)
  ) {
    return undefined;
  }
  return semantics.publicVerb;
}

export const dcAffiliatedWithRelation = defineRelationKind({
  kind: "dc.relation:affiliated_with",
});

export const dcGovernsRelation = defineRelationKind({
  kind: "dc.relation:governs",
});

export const dcReportsToRelation = defineRelationKind({
  kind: "dc.relation:reports_to",
});

export const dcAuthorizedByRelation = defineRelationKind({
  kind: "dc.relation:authorized_by",
});

export const dcContainsRelation = defineRelationKind({
  kind: "dc.relation:contains",
});

export const dcRepresentsRelation = defineRelationKind({
  kind: "dc.relation:represents",
});

export const dcHoldsRelation = defineRelationKind({
  kind: "dc.relation:holds",
});

export const dcChairsRelation = defineRelationKind({
  kind: "dc.relation:chairs",
});

export const dcMemberOfRelation = defineRelationKind({
  kind: "dc.relation:member_of",
});

export const dcPartOfRelation = defineRelationKind({
  kind: "dc.relation:part_of",
});
