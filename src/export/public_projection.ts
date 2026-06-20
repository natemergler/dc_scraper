import type { CitationValue, Entry } from "../core/types.ts";
import type { ReviewCategory, ReviewItem } from "../review/items.ts";

export type GovGraphNodeCategory =
  | "executive"
  | "legislative"
  | "public_body"
  | "neighborhood"
  | "judicial"
  | "representation"
  | "legal_authority";

export type GovGraphPublicStatus = "published";

export interface GovGraphNode {
  id: string;
  ledgerId: string;
  slug: string;
  name: string;
  category: GovGraphNodeCategory;
  kind: string;
  family: string;
  description?: string;
  officialUrl?: string;
  sourcePageUrl?: string;
  legalAuthorityIds: string[];
  sourceCitationCount: number;
  publicStatus: GovGraphPublicStatus;
}

export interface GovGraphEdge {
  id: string;
  from: string;
  to: string;
  relationKind: string;
  verb: string;
  citations: CitationValue[];
  publicStatus: GovGraphPublicStatus;
}

export interface GovGraphSummary {
  nodeCount: number;
  edgeCount: number;
  excludedNodeCount: number;
  excludedEdgeCount: number;
  blockedReviewItemCount: number;
  blockedReviewCountsByCategory: Partial<Record<ReviewCategory, number>>;
  mappedRelationCount: number;
}

export interface GovGraphProjection {
  nodes: GovGraphNode[];
  edges: GovGraphEdge[];
  summary: GovGraphSummary;
}

export interface DcAncSmdStructureRow {
  ancEntryId: string;
  ancName: string;
  ancShortName: string;
  smdEntryId: string;
  smdName: string;
  commissionerSeatEntryId: string;
  commissionerSeatName: string;
  currentCommissionerName: string;
  officerRole: string;
  relationCitations: CitationValue[];
}

export interface DcCouncilCommitteeMembershipRow {
  committeeEntryId: string;
  committeeName: string;
  committeeType: string;
  councilmemberEntryId: string;
  councilmemberName: string;
  membershipRole: "chair" | "member";
  relationCitations: CitationValue[];
}

const supportedKinds = new Set([
  "dc.agency",
  "dc.office",
  "dc.board",
  "dc.commission",
  "dc.authority",
  "dc.council",
  "dc.committee",
  "dc.councilmember",
  "dc.elected_office",
  "dc.ward",
  "dc.anc",
  "dc.smd",
  "dc.anc_commissioner_seat",
  "dc.court_system",
  "dc.court",
  "dc.court_division",
  "dc.legal_authority",
]);

const administrativeHomeKinds = new Set([
  "dc.board",
  "dc.commission",
  "dc.authority",
  "dc.council",
]);

export function buildGovGraphProjection(
  entries: Iterable<Entry>,
  reviewItems: ReviewItem[] = [],
): GovGraphProjection {
  const entryList = [...entries];
  const entryIndex = new Map(entryList.map((entry) => [entry.id, entry]));
  const blockingItems = reviewItems.filter((item) =>
    item.status === "open" &&
    item.blocks.releaseReadiness &&
    hasProjectionImpact(item)
  );

  const excludedNodeIds = new Set<string>();
  const excludedRelationIds = new Set<string>();
  const blockedReviewCountsByCategory: Partial<Record<ReviewCategory, number>> = {};

  for (const item of blockingItems) {
    blockedReviewCountsByCategory[item.category] =
      (blockedReviewCountsByCategory[item.category] ?? 0) + 1;

    for (const stateId of item.affected.stateIds) {
      excludedNodeIds.add(stateId);
    }

    for (const relation of item.affected.relationEndpoints) {
      excludedRelationIds.add(relationId(relation.from, relation.kind, relation.to));
    }
  }

  const includedNodeIds = new Set<string>();
  const nodes: GovGraphNode[] = [];

  for (const entry of entryList) {
    if (!supportedKinds.has(entry.kind) || excludedNodeIds.has(entry.id)) {
      continue;
    }

    includedNodeIds.add(entry.id);
    nodes.push({
      id: entry.id,
      ledgerId: entry.id,
      slug: slugFromLedgerId(entry.id),
      name: entry.name,
      category: nodeCategoryForKind(entry.kind),
      kind: entry.kind,
      family: entry.family,
      description: publicDescriptionForEntry(entry),
      officialUrl: publicOfficialUrlForEntry(entry),
      sourcePageUrl: publicSourcePageUrlForEntry(entry),
      legalAuthorityIds: authorizedByTargets(entry, entryIndex, excludedNodeIds),
      sourceCitationCount: sourceCitationCount(entry.citations),
      publicStatus: "published",
    });
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id));

  const edges: GovGraphEdge[] = [];
  let excludedEdgeCount = 0;
  let mappedRelationCount = 0;

  for (const entry of entryList) {
    if (!supportedKinds.has(entry.kind)) {
      continue;
    }

    if (!includedNodeIds.has(entry.id)) {
      excludedEdgeCount += relationCount(entry);
      continue;
    }

    const relationKinds = Object.keys(entry.relations).sort();
    for (const relationKind of relationKinds) {
      const relations = entry.relations[relationKind] ?? [];
      for (const relation of relations) {
        const currentRelationId = relationId(entry.id, relation.kind, relation.to);
        if (
          excludedRelationIds.has(currentRelationId) ||
          !includedNodeIds.has(relation.to)
        ) {
          excludedEdgeCount += 1;
          continue;
        }

        const target = entryIndex.get(relation.to);
        if (!target) {
          excludedEdgeCount += 1;
          continue;
        }

        const mapped = mapPublicRelation(entry, relation.kind, target);
        if (!mapped) {
          excludedEdgeCount += 1;
          continue;
        }

        if (mapped.verb !== rawVerbFromRelationKind(relation.kind)) {
          mappedRelationCount += 1;
        }

        edges.push({
          id: currentRelationId,
          from: entry.id,
          to: relation.to,
          relationKind: relation.kind,
          verb: mapped.verb,
          citations: relation.citations ?? [],
          publicStatus: "published",
        });
      }
    }
  }

  edges.sort((left, right) => {
    if (left.from === right.from) {
      if (left.verb === right.verb) {
        return left.to.localeCompare(right.to);
      }
      return left.verb.localeCompare(right.verb);
    }
    return left.from.localeCompare(right.from);
  });

  const supportedNodeCount = entryList.filter((entry) => supportedKinds.has(entry.kind)).length;

  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      excludedNodeCount: supportedNodeCount - nodes.length,
      excludedEdgeCount,
      blockedReviewItemCount: blockingItems.length,
      blockedReviewCountsByCategory,
      mappedRelationCount,
    },
  };
}

export function buildDcAncSmdStructureRows(
  entries: Iterable<Entry>,
): DcAncSmdStructureRow[] {
  const entryList = [...entries];
  const entryIndex = new Map(entryList.map((entry) => [entry.id, entry]));
  const seatBySmdId = new Map<string, Entry>();

  for (const entry of entryList) {
    if (entry.kind !== "dc.anc_commissioner_seat") {
      continue;
    }

    for (const relation of entry.relations["dc.relation:represents"] ?? []) {
      const smd = entryIndex.get(relation.to);
      if (smd?.kind === "dc.smd") {
        seatBySmdId.set(smd.id, entry);
      }
    }
  }

  const rows: DcAncSmdStructureRow[] = [];
  for (const anc of entryList) {
    if (anc.kind !== "dc.anc") {
      continue;
    }

    for (const relation of anc.relations["dc.relation:contains"] ?? []) {
      const smd = entryIndex.get(relation.to);
      if (smd?.kind !== "dc.smd") {
        continue;
      }

      const seat = seatBySmdId.get(smd.id);
      rows.push({
        ancEntryId: anc.id,
        ancName: anc.name,
        ancShortName: stringAttribute(anc, "shortName") ?? "",
        smdEntryId: smd.id,
        smdName: smd.name,
        commissionerSeatEntryId: seat?.id ?? "",
        commissionerSeatName: seat?.name ?? "",
        currentCommissionerName: seat ? stringAttribute(seat, "currentHolderName") ?? "" : "",
        officerRole: seat ? stringAttribute(seat, "officerRole") ?? "" : "",
        relationCitations: relation.citations ?? [],
      });
    }
  }

  return rows.sort((left, right) => {
    if (left.ancEntryId === right.ancEntryId) {
      return left.smdEntryId.localeCompare(right.smdEntryId);
    }
    return left.ancEntryId.localeCompare(right.ancEntryId);
  });
}

export function buildDcCouncilCommitteeMembershipRows(
  entries: Iterable<Entry>,
): DcCouncilCommitteeMembershipRow[] {
  const entryList = [...entries];
  const entryIndex = new Map(entryList.map((entry) => [entry.id, entry]));
  const rowsByMembership = new Map<string, DcCouncilCommitteeMembershipRow>();

  for (const councilmember of entryList) {
    if (councilmember.kind !== "dc.councilmember") {
      continue;
    }

    for (const relation of councilmember.relations["dc.relation:member_of"] ?? []) {
      const committee = entryIndex.get(relation.to);
      if (committee?.kind !== "dc.committee") {
        continue;
      }

      rowsByMembership.set(membershipKey(councilmember.id, committee.id), {
        committeeEntryId: committee.id,
        committeeName: committee.name,
        committeeType: stringAttribute(committee, "committeeType") ?? "",
        councilmemberEntryId: councilmember.id,
        councilmemberName: councilmember.name,
        membershipRole: "member",
        relationCitations: relation.citations ?? [],
      });
    }

    for (const relation of councilmember.relations["dc.relation:chairs"] ?? []) {
      const committee = entryIndex.get(relation.to);
      if (committee?.kind !== "dc.committee") {
        continue;
      }

      rowsByMembership.set(membershipKey(councilmember.id, committee.id), {
        committeeEntryId: committee.id,
        committeeName: committee.name,
        committeeType: stringAttribute(committee, "committeeType") ?? "",
        councilmemberEntryId: councilmember.id,
        councilmemberName: councilmember.name,
        membershipRole: "chair",
        relationCitations: relation.citations ?? [],
      });
    }
  }

  return [...rowsByMembership.values()].sort((left, right) => {
    if (left.committeeEntryId === right.committeeEntryId) {
      return left.councilmemberEntryId.localeCompare(right.councilmemberEntryId);
    }
    return left.committeeEntryId.localeCompare(right.committeeEntryId);
  });
}

function membershipKey(councilmemberId: string, committeeId: string): string {
  return `${councilmemberId}::${committeeId}`;
}

function hasProjectionImpact(item: ReviewItem): boolean {
  return item.affected.stateIds.length > 0 || item.affected.relationEndpoints.length > 0;
}

function relationId(from: string, relationKind: string, to: string): string {
  return `${from}::${relationKind}::${to}`;
}

function slugFromLedgerId(ledgerId: string): string {
  const separatorIndex = ledgerId.indexOf(":");
  return separatorIndex >= 0 ? ledgerId.slice(separatorIndex + 1) : ledgerId;
}

function nodeCategoryForKind(kind: string): GovGraphNodeCategory {
  switch (kind) {
    case "dc.agency":
    case "dc.office":
      return "executive";
    case "dc.council":
    case "dc.committee":
      return "legislative";
    case "dc.board":
    case "dc.commission":
    case "dc.authority":
      return "public_body";
    case "dc.anc":
    case "dc.smd":
    case "dc.anc_commissioner_seat":
      return "neighborhood";
    case "dc.court_system":
    case "dc.court":
    case "dc.court_division":
      return "judicial";
    case "dc.councilmember":
    case "dc.elected_office":
    case "dc.ward":
      return "representation";
    case "dc.legal_authority":
      return "legal_authority";
    default:
      return "public_body";
  }
}

function stringAttribute(entry: Entry, key: string): string | undefined {
  const value = entry.attributes[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function publicDescriptionForEntry(entry: Entry): string | undefined {
  const explicitDescription = stringAttribute(entry, "description") ??
    stringAttribute(entry, "sourceSummary");
  if (explicitDescription) {
    return explicitDescription;
  }

  if (entry.kind === "dc.anc_commissioner_seat") {
    const currentHolderName = stringAttribute(entry, "currentHolderName");
    const officerRole = stringAttribute(entry, "officerRole");
    if (currentHolderName && officerRole) {
      return `Current commissioner: ${currentHolderName}. Officer role: ${officerRole}.`;
    }
    if (currentHolderName) {
      return `Current commissioner: ${currentHolderName}.`;
    }
    if (officerRole) {
      return `Officer role: ${officerRole}.`;
    }
  }

  return undefined;
}

function publicOfficialUrlForEntry(entry: Entry): string | undefined {
  const candidates = [
    stringAttribute(entry, "officialUrl"),
    stringAttribute(entry, "webUrl"),
  ];

  return candidates.find((candidate) => candidate && candidate.length > 0);
}

function publicSourcePageUrlForEntry(entry: Entry): string | undefined {
  const candidates = [
    stringAttribute(entry, "sourceOpenDcUrl"),
    stringAttribute(entry, "sourceDccouncilUrl"),
    stringAttribute(entry, "sourceOancProfileUrl"),
    stringAttribute(entry, "sourcePageUrl"),
  ];

  return candidates.find((candidate) => candidate && candidate.length > 0);
}

function authorizedByTargets(
  entry: Entry,
  entryIndex: Map<string, Entry>,
  excludedNodeIds: Set<string>,
): string[] {
  const relations = entry.relations["dc.relation:authorized_by"] ?? [];
  return relations
    .map((relation) => relation.to)
    .filter((targetId) =>
      !excludedNodeIds.has(targetId) && entryIndex.get(targetId)?.kind === "dc.legal_authority"
    )
    .sort((left, right) => left.localeCompare(right));
}

function sourceCitationCount(citations: CitationValue[]): number {
  return citations.filter((citation) => "source" in citation).length;
}

function relationCount(entry: Entry): number {
  return Object.values(entry.relations).reduce((count, relations) => count + relations.length, 0);
}

function rawVerbFromRelationKind(relationKind: string): string {
  return relationKind.split(":").at(-1) ?? relationKind;
}

function mapPublicRelation(
  fromEntry: Entry,
  relationKind: string,
  toEntry: Entry,
): { verb: string } | undefined {
  switch (relationKind) {
    case "dc.relation:contains":
    case "dc.relation:reports_to":
    case "dc.relation:authorized_by":
    case "dc.relation:represents":
    case "dc.relation:holds":
    case "dc.relation:chairs":
    case "dc.relation:member_of":
    case "dc.relation:part_of":
    case "dc.relation:oversees":
    case "dc.relation:advises":
    case "dc.relation:appoints":
    case "dc.relation:elects":
    case "dc.relation:established_by":
    case "dc.relation:affiliated_with":
      return { verb: rawVerbFromRelationKind(relationKind) };
    case "dc.relation:governs":
      if (
        administrativeHomeKinds.has(fromEntry.kind) &&
        (toEntry.kind === "dc.agency" || toEntry.kind === "dc.office")
      ) {
        return { verb: "administered_by" };
      }
      return undefined;
    default:
      return undefined;
  }
}
