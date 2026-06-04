import {
  buildCandidateId,
  buildEntityId,
  buildLegalRefId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  detectEntityKind,
  parseLegalReference,
} from "../domain.ts";
import {
  artifact,
  buildCandidateReviewItem,
  buildKnownEntityRef,
  extractFirstUrl,
  fieldEvidence,
  maybeString,
} from "./shared.ts";
import type { ConnectorContext, ConnectorResult, SourceConnector } from "./shared.ts";
import type {
  EntityCandidateInput,
  LegalRefInput,
  RelationshipCandidateInput,
  ReviewItemInput,
  SourceDefinition,
  SourceEndpointDefinition,
  SourceFieldInput,
  SourceItemInput,
} from "../domain.ts";

const dcgisAgenciesSource: SourceDefinition = {
  sourceId: "dcgis.agencies",
  title: "District Government Agencies",
  kind: "arcgis_table",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6",
  tier: "tier0",
  releaseRole: "structure",
  smokeProfiles: ["structure", "tier0"],
  privacyNotes: [
    "Release public civic structure and legal refs only; contact-directory fields stay out.",
  ],
};

const dcgisBoardsCommissionsCouncilsSource: SourceDefinition = {
  sourceId: "dcgis.boards_commissions_councils",
  title: "District Boards, Commissions, and Councils",
  kind: "arcgis_table",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
  tier: "tier0",
  releaseRole: "public_body",
  smokeProfiles: ["structure", "tier0"],
  privacyNotes: [
    "Release public-body structure and legal refs only; do not widen into contact data.",
  ],
};

export const dcgisAgenciesConnector: SourceConnector = {
  sourceId: dcgisAgenciesSource.sourceId,
  source: dcgisAgenciesSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    return runDcgisTableSource(context, dcgisAgenciesSource, {
      endpointId: "dcgis.agencies.main",
      endpointTitle: "Government Operations agencies table",
      itemType: "agency_row",
      entityReason: "Review agency candidate from DCGIS",
      relationshipReason: "Review agency relationship inferred from branch metadata",
    });
  },
};

export const dcgisBoardsCommissionsCouncilsConnector: SourceConnector = {
  sourceId: dcgisBoardsCommissionsCouncilsSource.sourceId,
  source: dcgisBoardsCommissionsCouncilsSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    return runDcgisTableSource(context, dcgisBoardsCommissionsCouncilsSource, {
      endpointId: "dcgis.boards_commissions_councils.main",
      endpointTitle: "Government Operations boards, commissions, and councils table",
      itemType: "public_body_row",
      entityReason: "Review public-body candidate from DCGIS",
      relationshipReason: "Review public-body relationship from DCGIS metadata",
    });
  },
};

async function runDcgisTableSource(
  context: ConnectorContext,
  source: SourceDefinition,
  options: {
    endpointId: string;
    endpointTitle: string;
    itemType: string;
    entityReason: string;
    relationshipReason: string;
  },
): Promise<ConnectorResult> {
  const endpoint: SourceEndpointDefinition = {
    endpointId: options.endpointId,
    sourceId: source.sourceId,
    title: options.endpointTitle,
    kind: "arcgis_table",
    url: source.baseUrl,
    method: "GET",
    captureMode: "schema_rows",
  };
  const metadataUrl = `${source.baseUrl}?f=json`;
  const rowsUrl =
    `${source.baseUrl}/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json`;
  const metadataResponse = await context.fetcher(metadataUrl);
  const rowsResponse = await context.fetcher(rowsUrl);
  const metadataText = await metadataResponse.text();
  const rowsText = await rowsResponse.text();
  const metadata = JSON.parse(metadataText);
  const rowsPayload = JSON.parse(rowsText);
  const rows = parseDcgisRows(rowsPayload);
  const fields = buildDcgisFields(metadata);
  const items = buildDcgisItems(rows, options.itemType);
  const entityCandidates = buildDcgisEntityCandidates(source, items);
  const relationshipCandidates = buildDcgisRelationshipCandidates(source, items);
  const legalRefs = buildDcgisLegalRefs(source, items);
  const reviewItems = buildDcgisReviewItems(
    options.entityReason,
    options.relationshipReason,
    entityCandidates,
    relationshipCandidates,
  );
  return {
    source,
    endpointResults: [{
      endpoint,
      status: "success",
      artifacts: [
        artifact("schema", "json", metadataUrl, metadataText),
        artifact("rows", "json", rowsUrl, rowsText),
      ],
      parsed: {
        fields,
        items,
        entityCandidates,
        relationshipCandidates,
        legalRefs,
        reviewItems,
      },
    }],
  };
}

function parseDcgisRows(rowsPayload: Record<string, unknown>): Record<string, unknown>[] {
  const features = rowsPayload.features as Array<Record<string, unknown>> | undefined;
  const rows = rowsPayload.rows as Array<Record<string, unknown>> | undefined;
  return Array.isArray(features)
    ? features.map((feature) => {
      const attributes = feature.attributes as Record<string, unknown> | undefined;
      return attributes ?? {};
    })
    : (rows ?? []);
}

function buildDcgisFields(metadata: Record<string, unknown>): SourceFieldInput[] {
  const fields = metadata.fields as Array<Record<string, unknown>> | undefined;
  return (fields ?? []).map((field: Record<string, unknown>, index: number) => ({
    fieldName: String(field.name),
    fieldType: String(field.type ?? "unknown"),
    fieldLabel: String(field.alias ?? field.name),
    ordinal: index,
    artifactIndex: 0,
  }));
}

function buildDcgisItems(rows: Record<string, unknown>[], itemType: string): SourceItemInput[] {
  return rows.map((row) => ({
    itemKey: String(row.AGENCY_ID ?? row.ENTITY_ID ?? row.OBJECTID),
    itemType,
    title: String(row.AGENCY_NAME ?? row.NAME ?? row.SHORT_NAME ?? row.OBJECTID),
    body: row,
    artifactIndex: 1,
  }));
}

function buildDcgisEntityCandidates(
  source: SourceDefinition,
  items: SourceItemInput[],
): EntityCandidateInput[] {
  const agencyTaxonomyOnly = source.sourceId === "dcgis.agencies";
  const agencyCandidates = items.map((item) => {
    const row = item.body as Record<string, unknown>;
    const name = maybeString(row.AGENCY_NAME ?? row.NAME ?? row.SHORT_NAME) ?? item.title;
    return {
      candidateId: buildCandidateId(source.sourceId, item.itemKey),
      sourceItemKey: item.itemKey,
      proposedEntityId: buildKnownEntityRef(name),
      name,
      kind: detectEntityKind(String(row.TYPE ?? "agency"), name),
      rawKind: String(row.TYPE ?? "agency"),
      branch: agencyTaxonomyOnly ? undefined : maybeString(row.BRANCH),
      cluster: agencyTaxonomyOnly ? undefined : maybeString(row.MAYORAL_CLUSTER ?? row.CLUSTER_DC),
      officialUrl: maybeString(row.WEB_URL),
      confidence: 0.95,
      duplicateHint: maybeString(row.WEB_URL),
      evidence: [
        fieldEvidence("NAME", row.AGENCY_NAME ?? row.NAME, 1),
        fieldEvidence("TYPE", row.TYPE, 1),
        fieldEvidence("BRANCH", row.BRANCH, 1),
        fieldEvidence("MAYORAL_CLUSTER", row.MAYORAL_CLUSTER ?? row.CLUSTER_DC, 1),
        fieldEvidence("WEB_URL", row.WEB_URL, 1),
      ],
    };
  });
  if (agencyTaxonomyOnly) return agencyCandidates;

  const branchCandidates: EntityCandidateInput[] = [];
  const seenBranches = new Set<string>();
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const branch = maybeString(row.BRANCH);
    if (!branch || seenBranches.has(branch)) continue;
    seenBranches.add(branch);
    const name = `${branch} Branch`;
    branchCandidates.push({
      candidateId: buildCandidateId(source.sourceId, `branch-${branch}`),
      sourceItemKey: item.itemKey,
      proposedEntityId: buildEntityId(name),
      name,
      kind: "branch",
      rawKind: "branch",
      confidence: 0.99,
      evidence: [fieldEvidence("BRANCH", branch, 1)],
    });
  }
  return [...agencyCandidates, ...branchCandidates];
}

function buildDcgisRelationshipCandidates(
  source: SourceDefinition,
  items: SourceItemInput[],
): RelationshipCandidateInput[] {
  const relationshipCandidates: RelationshipCandidateInput[] = [];
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const name = maybeString(row.AGENCY_NAME ?? row.NAME) ?? item.title;
    const entityRef = buildKnownEntityRef(name);
    const branch = source.sourceId === "dcgis.agencies" ? undefined : maybeString(row.BRANCH);
    if (branch) {
      relationshipCandidates.push({
        relationshipCandidateId: buildRelationshipCandidateId(
          source.sourceId,
          `${item.itemKey}-branch`,
        ),
        sourceItemKey: item.itemKey,
        fromEntityRef: entityRef,
        toEntityRef: buildEntityId(`${branch} Branch`),
        relationshipType: "part_of",
        rawValue: branch,
        needsReview: branch === "Other",
        evidence: [fieldEvidence("BRANCH", branch, 1)],
      });
    }

    const governingAgency = maybeString(row.GOVERNING_AGENCY);
    if (!governingAgency || governingAgency.toLowerCase() === name.toLowerCase()) continue;
    relationshipCandidates.push({
      relationshipCandidateId: buildRelationshipCandidateId(
        source.sourceId,
        `${item.itemKey}-governing-agency`,
      ),
      sourceItemKey: item.itemKey,
      fromEntityRef: entityRef,
      toEntityRef: buildKnownEntityRef(governingAgency),
      relationshipType: "governed_by",
      rawValue: governingAgency,
      needsReview: false,
      evidence: [fieldEvidence("GOVERNING_AGENCY", governingAgency, 1)],
    });
  }
  return relationshipCandidates;
}

function buildDcgisLegalRefs(source: SourceDefinition, items: SourceItemInput[]): LegalRefInput[] {
  const legalRefs: LegalRefInput[] = [];
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const legislation = maybeString(row.LEGISLATION ?? row.AUTHORIZING_ORDER_LAW);
    if (!legislation) continue;
    const parsed = parseLegalReference(legislation, maybeString(row.WEB_URL));
    const entityName = maybeString(row.AGENCY_NAME ?? row.NAME) ?? item.title;
    legalRefs.push({
      legalRefId: buildLegalRefId(source.sourceId, `${item.itemKey}-legislation`),
      sourceItemKey: item.itemKey,
      refType: parsed.refType,
      citationText: parsed.citationText,
      normalizedCitation: parsed.normalizedCitation,
      url: extractFirstUrl(legislation) ?? maybeString(row.WEB_URL),
      needsReview: parsed.needsReview,
      evidence: [fieldEvidence("LEGISLATION", legislation, 1)],
      attachEntityRef: buildKnownEntityRef(entityName),
    });
  }
  return legalRefs;
}

function buildDcgisReviewItems(
  entityReason: string,
  relationshipReason: string,
  entityCandidates: EntityCandidateInput[],
  relationshipCandidates: RelationshipCandidateInput[],
): ReviewItemInput[] {
  return [
    ...entityCandidates.map((candidate) =>
      buildCandidateReviewItem(
        candidate.candidateId,
        entityReason,
        "accept",
        {
          name: candidate.name,
          kind: candidate.kind,
          confidence: candidate.confidence,
          officialUrl: candidate.officialUrl,
          duplicateHint: candidate.duplicateHint,
        },
      )
    ),
    ...relationshipCandidates.map((candidate) => ({
      reviewItemId: buildReviewItemId(
        candidate.relationshipCandidateId,
        candidate.relationshipType,
      ),
      itemType: "relationship_candidate" as const,
      subjectId: candidate.relationshipCandidateId,
      reason: relationshipReason,
      defaultAction: candidate.rawValue === "Other" ? "defer" : "accept",
      details: {
        fromEntityRef: candidate.fromEntityRef,
        toEntityRef: candidate.toEntityRef,
        relationshipType: candidate.relationshipType,
        rawValue: candidate.rawValue,
      },
    })),
  ];
}
