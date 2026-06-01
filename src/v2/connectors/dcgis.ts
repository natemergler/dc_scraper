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
};

export const dcgisAgenciesConnector: SourceConnector = {
  sourceId: dcgisAgenciesSource.sourceId,
  source: dcgisAgenciesSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "dcgis.agencies.main",
      sourceId: dcgisAgenciesSource.sourceId,
      title: "Government Operations agencies table",
      kind: "arcgis_table",
      url: dcgisAgenciesSource.baseUrl,
      method: "GET",
      captureMode: "schema_rows",
    };
    const metadataUrl = `${dcgisAgenciesSource.baseUrl}?f=json`;
    const rowsUrl =
      `${dcgisAgenciesSource.baseUrl}/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json`;
    const metadataResponse = await context.fetcher(metadataUrl);
    const rowsResponse = await context.fetcher(rowsUrl);
    const metadataText = await metadataResponse.text();
    const rowsText = await rowsResponse.text();
    const metadata = JSON.parse(metadataText);
    const rowsPayload = JSON.parse(rowsText);
    const rows = parseDcgisRows(rowsPayload);
    const fields = buildDcgisFields(metadata);
    const items = buildDcgisItems(rows);
    const entityCandidates = buildDcgisEntityCandidates(items);
    const relationshipCandidates = buildDcgisRelationshipCandidates(items);
    const legalRefs = buildDcgisLegalRefs(items);
    const reviewItems = buildDcgisReviewItems(entityCandidates, relationshipCandidates);
    return {
      source: dcgisAgenciesSource,
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
  },
};

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

function buildDcgisItems(rows: Record<string, unknown>[]): SourceItemInput[] {
  return rows.map((row) => ({
    itemKey: String(row.AGENCY_ID ?? row.OBJECTID),
    itemType: "agency_row",
    title: String(row.AGENCY_NAME ?? row.SHORT_NAME ?? row.OBJECTID),
    body: row,
    artifactIndex: 1,
  }));
}

function buildDcgisEntityCandidates(items: SourceItemInput[]): EntityCandidateInput[] {
  return items.map((item) => {
    const row = item.body as Record<string, unknown>;
    const name = String(row.AGENCY_NAME ?? row.SHORT_NAME ?? item.title);
    return {
      candidateId: buildCandidateId(dcgisAgenciesSource.sourceId, item.itemKey),
      sourceItemKey: item.itemKey,
      proposedEntityId: buildEntityId(name),
      name,
      kind: detectEntityKind(String(row.TYPE ?? "agency"), name),
      rawKind: String(row.TYPE ?? "agency"),
      branch: maybeString(row.BRANCH),
      cluster: maybeString(row.MAYORAL_CLUSTER),
      officialUrl: maybeString(row.WEB_URL),
      confidence: 0.95,
      duplicateHint: maybeString(row.WEB_URL),
      evidence: [
        fieldEvidence("AGENCY_NAME", row.AGENCY_NAME, 1),
        fieldEvidence("TYPE", row.TYPE, 1),
        fieldEvidence("WEB_URL", row.WEB_URL, 1),
      ],
    };
  });
}

function buildDcgisRelationshipCandidates(items: SourceItemInput[]): RelationshipCandidateInput[] {
  const relationshipCandidates: RelationshipCandidateInput[] = [];
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const name = String(row.AGENCY_NAME ?? item.title);
    const branch = maybeString(row.BRANCH);
    if (!branch) continue;
    relationshipCandidates.push({
      relationshipCandidateId: buildRelationshipCandidateId(
        dcgisAgenciesSource.sourceId,
        `${item.itemKey}-branch`,
      ),
      sourceItemKey: item.itemKey,
      fromEntityRef: buildEntityId(name),
      toEntityRef: buildEntityId(`${branch} Branch`),
      relationshipType: "part_of",
      rawValue: branch,
      evidence: [fieldEvidence("BRANCH", branch, 1)],
    });
  }
  return relationshipCandidates;
}

function buildDcgisLegalRefs(items: SourceItemInput[]): LegalRefInput[] {
  const legalRefs: LegalRefInput[] = [];
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const legislation = maybeString(row.LEGISLATION);
    if (!legislation) continue;
    const parsed = parseLegalReference(legislation, maybeString(row.WEB_URL));
    legalRefs.push({
      legalRefId: buildLegalRefId(dcgisAgenciesSource.sourceId, `${item.itemKey}-legislation`),
      sourceItemKey: item.itemKey,
      refType: parsed.refType,
      citationText: parsed.citationText,
      normalizedCitation: parsed.normalizedCitation,
      url: extractFirstUrl(legislation) ?? maybeString(row.WEB_URL),
      needsReview: parsed.needsReview,
      evidence: [fieldEvidence("LEGISLATION", legislation, 1)],
      attachEntityRef: buildEntityId(String(row.AGENCY_NAME ?? item.title)),
    });
  }
  return legalRefs;
}

function buildDcgisReviewItems(
  entityCandidates: EntityCandidateInput[],
  relationshipCandidates: RelationshipCandidateInput[],
): ReviewItemInput[] {
  return [
    ...entityCandidates.map((candidate) =>
      buildCandidateReviewItem(candidate.candidateId, "Review agency candidate from DCGIS", "accept", {
        name: candidate.name,
        kind: candidate.kind,
        confidence: candidate.confidence,
        officialUrl: candidate.officialUrl,
        duplicateHint: candidate.duplicateHint,
      })
    ),
    ...relationshipCandidates.map((candidate) => ({
      reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "branch"),
      itemType: "relationship_candidate" as const,
      subjectId: candidate.relationshipCandidateId,
      reason: "Review agency relationship inferred from branch metadata",
      defaultAction: "accept",
      details: {
        fromEntityRef: candidate.fromEntityRef,
        toEntityRef: candidate.toEntityRef,
        relationshipType: candidate.relationshipType,
        rawValue: candidate.rawValue,
      },
    })),
  ];
}
