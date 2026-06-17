import { assertEquals } from "@std/assert";

import type { CitationValue, Entry } from "../../src/core/types.ts";
import { buildGovGraphProjection } from "../../src/export/public_projection.ts";
import type { ReviewItem } from "../../src/review/items.ts";

const sourceCitation = (source: string, sourceRecordId: string): CitationValue => ({
  source,
  sourceRecordId,
});

Deno.test("buildGovGraphProjection maps administrative home edges and excludes release-blocked nodes", () => {
  const entries: Entry[] = [
    {
      id: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: {
        officialUrl: "https://agency.example",
      },
      citations: [sourceCitation("dcgis.agencies", "a-1")],
      relations: {},
    },
    {
      id: "dc.board:b-1",
      family: "organization",
      kind: "dc.board",
      name: "Board One",
      attributes: {
        sourcePageUrl: "https://board.example",
      },
      citations: [sourceCitation("dcgis.boards", "b-1")],
      relations: {
        "dc.relation:authorized_by": [{
          kind: "dc.relation:authorized_by",
          to: "dc.legal_authority:law-1",
          citations: [sourceCitation("dcgis.boards", "b-1")],
        }],
        "dc.relation:governs": [{
          kind: "dc.relation:governs",
          to: "dc.agency:a-1",
          citations: [sourceCitation("dcgis.boards", "b-1")],
        }],
      },
    },
    {
      id: "dc.legal_authority:law-1",
      family: "authority",
      kind: "dc.legal_authority",
      name: "D.C. Code 1-1",
      attributes: {},
      citations: [sourceCitation("legal.entrypoints", "law-1")],
      relations: {},
    },
    {
      id: "dc.anc:8F",
      family: "organization",
      kind: "dc.anc",
      name: "ANC 8F",
      attributes: {
        webUrl: "https://anc.example/8f",
      },
      citations: [sourceCitation("dcgis.ancs", "8F")],
      relations: {
        "dc.relation:contains": [{
          kind: "dc.relation:contains",
          to: "dc.smd:8F01",
          citations: [sourceCitation("dcgis.smds", "8F01")],
        }],
      },
    },
    {
      id: "dc.smd:8F01",
      family: "area",
      kind: "dc.smd",
      name: "SMD 8F01",
      attributes: {},
      citations: [sourceCitation("dcgis.smds", "8F01")],
      relations: {},
    },
    {
      id: "dc.anc_commissioner_seat:8F01",
      family: "position",
      kind: "dc.anc_commissioner_seat",
      name: "Commissioner Seat for SMD 8F01",
      attributes: {
        currentHolderName: "Nic Wilson",
        officerRole: "Chairperson",
      },
      citations: [sourceCitation("oanc.profiles", "6/8F")],
      relations: {},
    },
  ];

  const reviewItems: ReviewItem[] = [
    makeReviewItem({
      id: "anc-review",
      category: "identity_conflict",
      stateIds: ["dc.anc:8F"],
      relationEndpoints: [{
        from: "dc.anc:8F",
        kind: "dc.relation:contains",
        to: "dc.smd:8F01",
      }],
    }),
    makeReviewItem({
      id: "out-of-scope-finding",
      category: "out_of_scope_candidate",
      stateIds: [],
      relationEndpoints: [],
    }),
  ];

  const projection = buildGovGraphProjection(entries, reviewItems);

  assertEquals(projection.nodes.map((node) => node.id), [
    "dc.agency:a-1",
    "dc.anc_commissioner_seat:8F01",
    "dc.board:b-1",
    "dc.legal_authority:law-1",
    "dc.smd:8F01",
  ]);
  assertEquals(
    projection.nodes.find((node) => node.id === "dc.anc_commissioner_seat:8F01")?.description,
    "Current commissioner: Nic Wilson. Officer role: Chairperson.",
  );
  assertEquals(
    projection.nodes.find((node) => node.id === "dc.board:b-1")?.legalAuthorityIds,
    ["dc.legal_authority:law-1"],
  );
  assertEquals(
    projection.nodes.find((node) => node.id === "dc.agency:a-1")?.officialUrl,
    "https://agency.example",
  );

  assertEquals(projection.edges, [{
    id: "dc.board:b-1::dc.relation:governs::dc.agency:a-1",
    from: "dc.board:b-1",
    to: "dc.agency:a-1",
    relationKind: "dc.relation:governs",
    verb: "administered_by",
    citations: [sourceCitation("dcgis.boards", "b-1")],
    publicStatus: "published",
  }, {
    id: "dc.board:b-1::dc.relation:authorized_by::dc.legal_authority:law-1",
    from: "dc.board:b-1",
    to: "dc.legal_authority:law-1",
    relationKind: "dc.relation:authorized_by",
    verb: "authorized_by",
    citations: [sourceCitation("dcgis.boards", "b-1")],
    publicStatus: "published",
  }]);

  assertEquals(projection.summary.nodeCount, 5);
  assertEquals(projection.summary.edgeCount, 2);
  assertEquals(projection.summary.excludedNodeCount, 1);
  assertEquals(projection.summary.excludedEdgeCount, 1);
  assertEquals(projection.summary.blockedReviewItemCount, 1);
  assertEquals(projection.summary.blockedReviewCountsByCategory.identity_conflict, 1);
  assertEquals(projection.summary.blockedReviewCountsByCategory.out_of_scope_candidate, undefined);
  assertEquals(projection.summary.mappedRelationCount, 1);
});

function makeReviewItem(
  options: {
    id: string;
    category: ReviewItem["category"];
    stateIds: string[];
    relationEndpoints: Array<{ from: string; kind: string; to: string }>;
  },
): ReviewItem {
  return {
    id: options.id,
    category: options.category,
    classification: "curation_conflict",
    severity: "medium",
    confidence: "medium",
    status: "open",
    title: "fixture review item",
    summary: "fixture review item",
    sourceFamilies: ["fixture"],
    affected: {
      fragmentIds: [],
      baselineIds: options.stateIds,
      stateIds: options.stateIds,
      relationEndpoints: options.relationEndpoints,
    },
    candidateEntries: [],
    sourceRefs: [],
    citations: [],
    urls: [],
    legalLocators: [],
    attributesThatAgree: {},
    attributesThatConflict: {},
    suggestedResolutions: ["suppress"],
    blocks: {
      stateGeneration: false,
      releaseReadiness: true,
    },
    draftRevisionIds: [],
    trackedRevisionIds: [],
    rationale: "fixture review item",
    generatedAt: "2026-06-16T00:00:00.000Z",
    source: {
      type: "reconciliation_candidate",
      id: options.id,
    },
  };
}
