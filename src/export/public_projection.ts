import type { CitationValue, Entry } from "../core/types.ts";
import {
  type DcPublicNodeCategory,
  dcPublicNodeCategory,
  dcPublicNodeKinds,
} from "../jurisdictions/dc/kinds/entity.ts";
import { dcPublicRelationVerb, dcRawRelationVerb } from "../jurisdictions/dc/kinds/relation.ts";
import {
  type ReviewCategory,
  type ReviewItem,
  reviewItemBlocksCurrentOutput,
  type ReviewQueue,
  reviewQueueForItem,
} from "../review/items.ts";

export type GovGraphNodeCategory = DcPublicNodeCategory;

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
  nodeKindCounts: Record<string, number>;
  nodeCategoryCounts: Record<string, number>;
  nonGraphLedgerEntryKinds: Record<string, number>;
  nonGraphLedgerEntryNote: string;
  edgeCount: number;
  edgeVerbCounts: Record<string, number>;
  excludedNodeCount: number;
  excludedEdgeCount: number;
  blockedReviewItemCount: number;
  releaseBlockingReviewItemCount: number;
  nonBlockingDeferredReviewItemCount: number;
  reviewPosture: {
    releaseBlockingReviewItemCount: number;
    nonBlockingDeferredReviewItemCount: number;
    note: string;
  };
  reviewQueueCounts: Record<ReviewQueue, number>;
  blockedReviewCountsByCategory: Partial<Record<ReviewCategory, number>>;
  mappedRelationCount: number;
  mappedRelationCounts: MappedRelationCount[];
  nodeFieldDescriptions: Record<string, string>;
  edgeFieldDescriptions: Record<string, string>;
  citationFieldDescriptions: Record<string, string>;
  joinRules: string[];
  relationFieldDescriptions: {
    relationKind: string;
    verb: string;
  };
}

export interface MappedRelationCount {
  relationKind: string;
  verb: string;
  count: number;
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

const supportedKinds = new Set(dcPublicNodeKinds());
const reviewQueues: ReviewQueue[] = ["blocking", "actionable", "drafted", "applied", "deferred"];

export function buildGovGraphProjection(
  entries: Iterable<Entry>,
  reviewItems: ReviewItem[] = [],
): GovGraphProjection {
  const entryList = [...entries];
  const entryIndex = new Map(entryList.map((entry) => [entry.id, entry]));
  const blockingItems = reviewItems.filter(reviewItemBlocksCurrentOutput);

  const excludedNodeIds = new Set<string>();
  const excludedRelationIds = new Set<string>();
  const blockedReviewCountsByCategory: Partial<Record<ReviewCategory, number>> = {};
  const reviewQueueCounts = Object.fromEntries(
    reviewQueues.map((queue) => [queue, 0]),
  ) as Record<ReviewQueue, number>;

  for (const item of reviewItems) {
    const queue = reviewQueueForItem(item);
    reviewQueueCounts[queue] += 1;
  }

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
  const mappedRelationCounts = new Map<string, MappedRelationCount>();

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

        if (mapped.verb !== dcRawRelationVerb(relation.kind)) {
          mappedRelationCount += 1;
          const mappingKey = `${relation.kind}\u0000${mapped.verb}`;
          const current = mappedRelationCounts.get(mappingKey) ?? {
            relationKind: relation.kind,
            verb: mapped.verb,
            count: 0,
          };
          current.count += 1;
          mappedRelationCounts.set(mappingKey, current);
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
  const nodeKindCounts = countSorted(nodes.map((node) => node.kind));
  const nodeCategoryCounts = countSorted(nodes.map((node) => node.category));
  const nonGraphLedgerEntryKinds = countSorted(
    entryList.filter((entry) => !supportedKinds.has(entry.kind)).map((entry) => entry.kind),
  );
  const edgeVerbCounts = countSorted(edges.map((edge) => edge.verb));
  const releaseBlockingReviewItemCount = blockingItems.length;
  const nonBlockingDeferredReviewItemCount = reviewQueueCounts.deferred;

  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      nodeKindCounts,
      nodeCategoryCounts,
      nonGraphLedgerEntryKinds,
      nonGraphLedgerEntryNote:
        "Ledger entries in nonGraphLedgerEntryKinds are source or audit anchors and are intentionally not projected as GovGraph nodes.",
      edgeCount: edges.length,
      edgeVerbCounts,
      excludedNodeCount: supportedNodeCount - nodes.length,
      excludedEdgeCount,
      blockedReviewItemCount: blockingItems.length,
      releaseBlockingReviewItemCount,
      nonBlockingDeferredReviewItemCount,
      reviewPosture: {
        releaseBlockingReviewItemCount,
        nonBlockingDeferredReviewItemCount,
        note:
          "releaseBlockingReviewItemCount must be zero for release; nonBlockingDeferredReviewItemCount records deferred review work that is outside the current public-output release path.",
      },
      reviewQueueCounts,
      blockedReviewCountsByCategory,
      mappedRelationCount,
      mappedRelationCounts: [...mappedRelationCounts.values()].sort((left, right) => {
        if (left.relationKind === right.relationKind) {
          return left.verb.localeCompare(right.verb);
        }
        return left.relationKind.localeCompare(right.relationKind);
      }),
      nodeFieldDescriptions: {
        id: "Stable GovGraph node ID; equals ledgerId for this release.",
        ledgerId: "Stable Civic Ledger entry ID.",
        slug: "Human-readable slug derived from the entry ID.",
        name: "Display name from current committed state.",
        category:
          "Public graph category such as executive, legislative, public_body, neighborhood, representation, judicial, or legal_authority.",
        kind: "Stable Civic Ledger entry kind.",
        family: "High-level ledger family such as organization, position, person, area, or legal.",
        officialUrl: "Official URL when the current source-backed state has one.",
        sourcePageUrl: "Primary source page URL used for this node when available.",
        legalAuthorityIds:
          "GovGraph node IDs for legal authority entries linked by authorized_by edges.",
        sourceCitationCount: "Count of source citations attached to the node.",
        publicStatus: "published when the node is included in the public GovGraph release.",
      },
      edgeFieldDescriptions: {
        id: "Stable edge triple identifier: from::relationKind::to.",
        from: "Source node ID; joins to govgraph_nodes.json id.",
        to: "Target node ID; joins to govgraph_nodes.json id.",
        relationKind: "Stable raw Civic Ledger relation identifier.",
        verb: "Public relationship label for release consumers.",
        citations: "Source citations supporting the edge.",
        publicStatus: "published when the edge is included in the public GovGraph release.",
      },
      citationFieldDescriptions: {
        source: "Source identifier from dc_sources.csv or internal source inventory.",
        sourceRecordId: "Source record key when available.",
        locator: "Source locator such as a section, page, or legal citation when available.",
        url: "Source URL when available.",
      },
      joinRules: [
        "govgraph_edges.json from and to values join to govgraph_nodes.json id.",
        "GovGraph node id values match release CSV ID columns when the same civic object appears in both surfaces.",
        "dc.councilmember is the elected Council member kind; dc.council is a council-type public body kind.",
        "Ledger entry counts can exceed GovGraph node counts because source/audit anchor kinds listed in nonGraphLedgerEntryKinds are not graph nodes.",
      ],
      relationFieldDescriptions: {
        relationKind: "Stable raw ledger relation identifier.",
        verb: "Public relationship label for release consumers.",
      },
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

function relationId(from: string, relationKind: string, to: string): string {
  return `${from}::${relationKind}::${to}`;
}

function slugFromLedgerId(ledgerId: string): string {
  const separatorIndex = ledgerId.indexOf(":");
  return separatorIndex >= 0 ? ledgerId.slice(separatorIndex + 1) : ledgerId;
}

function nodeCategoryForKind(kind: string): GovGraphNodeCategory {
  return dcPublicNodeCategory(kind) ?? "public_body";
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
    entry.kind === "dc.legal_authority" ? stringAttribute(entry, "canonicalUrl") : undefined,
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

function countSorted(values: Iterable<string>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function mapPublicRelation(
  fromEntry: Entry,
  relationKind: string,
  toEntry: Entry,
): { verb: string } | undefined {
  const verb = dcPublicRelationVerb({
    relationKind,
    fromKind: fromEntry.kind,
    toKind: toEntry.kind,
  });
  return verb ? { verb } : undefined;
}
