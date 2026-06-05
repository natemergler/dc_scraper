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
  actSuggestionFromLawXml,
  DC_LAW_INDEX_URL,
  type DcLawActSuggestion,
  DcLawTitleIndex,
  dcLawXmlPeriodIndexUrl,
  dcLawXmlRawUrl,
  lawXmlNumbersFromPeriodIndex,
  looksLikeDcLawTitle,
  malformedDcActNumber,
  periodFromActNumber,
} from "./dc_law_index.ts";
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
  ArtifactCaptureInput,
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

const dcgisAgencyRowFields = [
  "OBJECTID",
  "AGENCY_ID",
  "AGENCY_NAME",
  "TYPE",
  "WEB_URL",
  "BRANCH",
  "MAYORAL_CLUSTER",
  "LEGISLATION",
];

const dcgisBoardsCommissionsCouncilsRowFields = [
  "OBJECTID",
  "ENTITY_ID",
  "NAME",
  "SHORT_NAME",
  "TYPE",
  "WEB_URL",
  "GOVERNING_AGENCY",
  "AUTHORIZING_ORDER_LAW",
  "CLUSTER_DC",
];

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
      rowFields: dcgisAgencyRowFields,
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
      rowFields: dcgisBoardsCommissionsCouncilsRowFields,
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
    rowFields: string[];
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
  context.onProgress?.({ message: "Fetching DCGIS table metadata" });
  const metadataResponse = await context.fetcher(metadataUrl);
  const metadataText = await metadataResponse.text();
  const metadata = JSON.parse(metadataText);
  const maxRecordCount = Math.max(1, Number(metadata.maxRecordCount ?? 1000));
  const requestedLimit = typeof context.limit === "number"
    ? Math.max(0, Math.floor(context.limit))
    : undefined;
  const rowArtifacts: ReturnType<typeof artifact>[] = [];
  const fetchedRows: DcgisFetchedRow[] = [];
  let offset = 0;
  let pageNumber = 1;
  while (requestedLimit === undefined || offset < requestedLimit) {
    const remainingLimit = requestedLimit === undefined ? maxRecordCount : requestedLimit - offset;
    const pageSize = Math.min(maxRecordCount, remainingLimit);
    if (pageSize <= 0) break;
    const rowsUrl = buildArcGisQueryUrl(source.baseUrl, {
      where: "1=1",
      outFields: options.rowFields.join(","),
      orderByFields: "OBJECTID",
      returnGeometry: "false",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: "json",
    });
    context.onProgress?.({
      message: `Fetching DCGIS rows starting at ${
        offset + 1
      } (page ${pageNumber}, up to ${pageSize})`,
    });
    const rowsResponse = await context.fetcher(rowsUrl);
    const rowsText = await rowsResponse.text();
    const artifactIndex = rowArtifacts.length + 1;
    rowArtifacts.push(artifact("rows", "json", rowsUrl, rowsText));
    const rowsPayload = JSON.parse(rowsText);
    assertNoArcGisError(source, rowsPayload);
    const pageRows = parseDcgisRows(rowsPayload);
    const consumedRows = pageRows.slice(0, pageSize);
    for (const row of consumedRows) {
      fetchedRows.push({ row, artifactIndex });
    }
    if (consumedRows.length < pageSize) break;
    offset += consumedRows.length;
    pageNumber += 1;
  }
  const fields = buildDcgisFields(metadata);
  const items = buildDcgisItems(fetchedRows, options.itemType);
  let nextArtifactIndex = rowArtifacts.length + 1;
  const lawTitleIndex = await fetchLawTitleIndexIfNeeded(context, items, nextArtifactIndex);
  if (lawTitleIndex) nextArtifactIndex += 1;
  const actSuggestionIndex = await fetchActSuggestionIndexIfNeeded(
    context,
    items,
    nextArtifactIndex,
  );
  const entityCandidates = buildDcgisEntityCandidates(source, items);
  const relationshipCandidates = buildDcgisRelationshipCandidates(source, items);
  const legalRefs = buildDcgisLegalRefs(source, items, lawTitleIndex, actSuggestionIndex);
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
        ...rowArtifacts,
        ...(lawTitleIndex ? [lawTitleIndex.artifact] : []),
        ...(actSuggestionIndex?.artifacts ?? []),
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

interface DcgisFetchedRow {
  row: Record<string, unknown>;
  artifactIndex: number;
}

function assertNoArcGisError(source: SourceDefinition, rowsPayload: Record<string, unknown>): void {
  const error = rowsPayload.error as Record<string, unknown> | undefined;
  if (!error) return;
  const message = String(error.message ?? "ArcGIS query failed");
  const details = Array.isArray(error.details) ? `: ${error.details.join("; ")}` : "";
  throw new Error(`${source.sourceId} ${message}${details}`);
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

function buildDcgisItems(rows: DcgisFetchedRow[], itemType: string): SourceItemInput[] {
  return rows.map(({ row, artifactIndex }) => ({
    itemKey: String(row.AGENCY_ID ?? row.ENTITY_ID ?? row.OBJECTID),
    itemType,
    title: String(row.AGENCY_NAME ?? row.NAME ?? row.SHORT_NAME ?? row.OBJECTID),
    body: row,
    artifactIndex,
  }));
}

function buildArcGisQueryUrl(
  baseUrl: string,
  params: Record<string, string>,
): string {
  const url = new URL(`${baseUrl}/query`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildDcgisEntityCandidates(
  source: SourceDefinition,
  items: SourceItemInput[],
): EntityCandidateInput[] {
  const agencyTaxonomyOnly = source.sourceId === "dcgis.agencies";
  const agencyCandidates = items.flatMap((item) => {
    const row = item.body as Record<string, unknown>;
    const identity = dcgisEntityIdentity(row, agencyTaxonomyOnly);
    if (!identity) return [];
    const artifactIndex = dcgisRowArtifactIndex(item);
    return [{
      candidateId: buildCandidateId(source.sourceId, item.itemKey),
      sourceItemKey: item.itemKey,
      proposedEntityId: identity.entityRef,
      name: identity.name,
      kind: detectEntityKind(String(row.TYPE ?? "agency"), identity.name),
      rawKind: String(row.TYPE ?? "agency"),
      branch: agencyTaxonomyOnly ? undefined : maybeString(row.BRANCH),
      cluster: agencyTaxonomyOnly ? undefined : maybeString(row.MAYORAL_CLUSTER ?? row.CLUSTER_DC),
      officialUrl: maybeString(row.WEB_URL),
      confidence: 0.95,
      duplicateHint: maybeString(row.WEB_URL),
      evidence: [
        fieldEvidence("NAME", row.AGENCY_NAME ?? row.NAME, artifactIndex),
        ...(agencyTaxonomyOnly ? [] : [
          fieldEvidence("SHORT_NAME", row.SHORT_NAME, artifactIndex),
          fieldEvidence("GOVERNING_AGENCY", row.GOVERNING_AGENCY, artifactIndex),
          fieldEvidence("AUTHORIZING_ORDER_LAW", row.AUTHORIZING_ORDER_LAW, artifactIndex),
        ]),
        fieldEvidence("TYPE", row.TYPE, artifactIndex),
        fieldEvidence("BRANCH", row.BRANCH, artifactIndex),
        fieldEvidence("MAYORAL_CLUSTER", row.MAYORAL_CLUSTER ?? row.CLUSTER_DC, artifactIndex),
        fieldEvidence("WEB_URL", row.WEB_URL, artifactIndex),
      ],
    }];
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
      evidence: [fieldEvidence("BRANCH", branch, dcgisRowArtifactIndex(item))],
    });
  }
  return [...agencyCandidates, ...branchCandidates];
}

interface DcgisEntityIdentity {
  name: string;
  entityRef: string;
  governingAgency?: string;
  governingAgencyRef?: string;
  governingAgencyNeedsReview?: boolean;
}

function dcgisEntityIdentity(
  row: Record<string, unknown>,
  agencyTaxonomyOnly: boolean,
): DcgisEntityIdentity | undefined {
  const rawName = maybeString(row.AGENCY_NAME ?? row.NAME ?? row.SHORT_NAME);
  if (!rawName) return undefined;
  const name = agencyTaxonomyOnly ? rawName : publicBodyCandidateName(row, rawName);
  const governingAgency = maybeString(row.GOVERNING_AGENCY);
  const governingAgencyNeedsReview = !agencyTaxonomyOnly &&
    Boolean(
      governingAgency &&
        governingAgency.toLowerCase() === rawName.toLowerCase() &&
        name.toLowerCase() !== rawName.toLowerCase(),
    );
  return {
    name,
    entityRef: buildKnownEntityRef(name),
    governingAgency,
    governingAgencyRef: governingAgency ? buildKnownEntityRef(governingAgency) : undefined,
    governingAgencyNeedsReview,
  };
}

function publicBodyCandidateName(row: Record<string, unknown>, rawName: string): string {
  const governingAgency = maybeString(row.GOVERNING_AGENCY);
  const rawType = maybeString(row.TYPE);
  if (!governingAgency || !rawType) return rawName;
  if (governingAgency.toLowerCase() !== rawName.toLowerCase()) return rawName;
  const bodyType = publicBodyTypeName(rawType);
  if (!bodyType) return rawName;
  if (!maybeString(row.AUTHORIZING_ORDER_LAW)) return rawName;
  if (!publicBodyUrlPathIncludesType(maybeString(row.WEB_URL), bodyType)) return rawName;
  const replaced = rawName.replace(
    /\b(?:Administration|Agency|Department|Office)\b\s*$/i,
    bodyType,
  );
  return replaced !== rawName ? replaced : rawName;
}

function publicBodyTypeName(rawType: string): string | undefined {
  switch (rawType.trim().toLowerCase()) {
    case "board":
      return "Board";
    case "commission":
      return "Commission";
    case "council":
      return "Council";
    case "committee":
      return "Committee";
    case "task force":
      return "Task Force";
    default:
      return undefined;
  }
}

function publicBodyUrlPathIncludesType(rawUrl: string | undefined, bodyType: string): boolean {
  if (!rawUrl) return false;
  let pathSegment: string;
  try {
    const url = new URL(rawUrl);
    pathSegment = decodeURIComponent(url.pathname).split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return false;
  }
  const slugTokens = pathSegment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const typeTokens = bodyType.toLowerCase().split(/\s+/);
  return typeTokens.every((token) => slugTokens.includes(token));
}

function buildDcgisRelationshipCandidates(
  source: SourceDefinition,
  items: SourceItemInput[],
): RelationshipCandidateInput[] {
  const relationshipCandidates: RelationshipCandidateInput[] = [];
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const identity = dcgisEntityIdentity(row, source.sourceId === "dcgis.agencies");
    if (!identity) continue;
    const entityRef = identity.entityRef;
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
        evidence: [fieldEvidence("BRANCH", branch, dcgisRowArtifactIndex(item))],
      });
    }

    const governingAgency = identity.governingAgency;
    if (
      !governingAgency || !identity.governingAgencyRef ||
      identity.governingAgencyRef === identity.entityRef
    ) continue;
    relationshipCandidates.push({
      relationshipCandidateId: buildRelationshipCandidateId(
        source.sourceId,
        `${item.itemKey}-governing-agency`,
      ),
      sourceItemKey: item.itemKey,
      fromEntityRef: entityRef,
      toEntityRef: identity.governingAgencyRef,
      relationshipType: "governed_by",
      rawValue: governingAgency,
      needsReview: identity.governingAgencyNeedsReview ?? false,
      evidence: [fieldEvidence("GOVERNING_AGENCY", governingAgency, dcgisRowArtifactIndex(item))],
    });
  }
  return relationshipCandidates;
}

interface DcgisLawTitleIndex {
  index: DcLawTitleIndex;
  artifact: ArtifactCaptureInput;
  artifactIndex: number;
}

interface DcgisActSuggestionMatch {
  suggestion: DcLawActSuggestion;
  artifactIndex: number;
}

interface DcgisActSuggestionIndex {
  matches: Map<string, DcgisActSuggestionMatch>;
  artifacts: ArtifactCaptureInput[];
}

async function fetchLawTitleIndexIfNeeded(
  context: ConnectorContext,
  items: SourceItemInput[],
  artifactIndex: number,
): Promise<DcgisLawTitleIndex | undefined> {
  if (!dcgisItemsNeedLawTitleIndex(items)) return undefined;
  context.onProgress?.({ message: "Fetching D.C. Council law title index" });
  const response = await context.fetcher(DC_LAW_INDEX_URL);
  const text = await response.text();
  return {
    index: DcLawTitleIndex.fromJsonText(text),
    artifact: artifact("rows", "json", DC_LAW_INDEX_URL, text),
    artifactIndex,
  };
}

async function fetchActSuggestionIndexIfNeeded(
  context: ConnectorContext,
  items: SourceItemInput[],
  nextArtifactIndex: number,
): Promise<DcgisActSuggestionIndex | undefined> {
  const wanted = dcgisMalformedActNumbersByPeriod(items);
  if (wanted.size === 0) return undefined;

  const artifacts: ArtifactCaptureInput[] = [];
  const matches = new Map<string, DcgisActSuggestionMatch>();
  let artifactIndex = nextArtifactIndex;
  for (const [period, actNumbers] of wanted) {
    context.onProgress?.({ message: `Fetching D.C. Council law XML period ${period} index` });
    const periodIndexUrl = dcLawXmlPeriodIndexUrl(period);
    const periodIndexResponse = await context.fetcher(periodIndexUrl);
    const periodIndexText = await periodIndexResponse.text();
    artifacts.push(artifact("rows", "xml", periodIndexUrl, periodIndexText));
    artifactIndex += 1;

    for (const lawNumber of lawXmlNumbersFromPeriodIndex(periodIndexText)) {
      const unresolved = [...actNumbers].filter((actNumber) => !matches.has(actNumber));
      if (unresolved.length === 0) break;
      const lawXmlUrl = dcLawXmlRawUrl(period, lawNumber);
      const lawXmlResponse = await context.fetcher(lawXmlUrl);
      const lawXmlText = await lawXmlResponse.text();
      const suggestions: Array<{ actNumber: string; suggestion: DcLawActSuggestion }> = [];
      for (const actNumber of unresolved) {
        const suggestion = actSuggestionFromLawXml(lawXmlText, actNumber);
        if (suggestion) suggestions.push({ actNumber, suggestion });
      }
      if (suggestions.length > 0) {
        const lawArtifactIndex = artifactIndex;
        artifacts.push(artifact("rows", "xml", lawXmlUrl, lawXmlText));
        artifactIndex += 1;
        for (const { actNumber, suggestion } of suggestions) {
          matches.set(actNumber, { suggestion, artifactIndex: lawArtifactIndex });
        }
      }
    }
  }
  return artifacts.length > 0 ? { matches, artifacts } : undefined;
}

function dcgisMalformedActNumbersByPeriod(items: SourceItemInput[]): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>();
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const legislation = maybeString(row.LEGISLATION ?? row.AUTHORIZING_ORDER_LAW);
    if (!legislation) continue;
    for (const citationText of splitDcgisLegalAuthority(legislation)) {
      const parsed = parseLegalReference(citationText);
      if (parsed.refType !== "unknown") continue;
      const actNumber = malformedDcActNumber(parsed.citationText);
      const period = actNumber ? periodFromActNumber(actNumber) : undefined;
      if (!actNumber || !period) continue;
      const actNumbers = wanted.get(period) ?? new Set<string>();
      actNumbers.add(actNumber);
      wanted.set(period, actNumbers);
    }
  }
  return wanted;
}

function dcgisItemsNeedLawTitleIndex(items: SourceItemInput[]): boolean {
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const legislation = maybeString(row.LEGISLATION ?? row.AUTHORIZING_ORDER_LAW);
    if (!legislation) continue;
    for (const citationText of splitDcgisLegalAuthority(legislation)) {
      const parsed = parseLegalReference(citationText);
      if (parsed.refType === "unknown" && looksLikeDcLawTitle(parsed.citationText)) return true;
    }
  }
  return false;
}

function buildDcgisLegalRefs(
  source: SourceDefinition,
  items: SourceItemInput[],
  lawTitleIndex?: DcgisLawTitleIndex,
  actSuggestionIndex?: DcgisActSuggestionIndex,
): LegalRefInput[] {
  const legalRefs: LegalRefInput[] = [];
  for (const item of items) {
    const row = item.body as Record<string, unknown>;
    const legislationField = row.LEGISLATION !== undefined
      ? "LEGISLATION"
      : "AUTHORIZING_ORDER_LAW";
    const legislation = maybeString(row.LEGISLATION ?? row.AUTHORIZING_ORDER_LAW);
    if (!legislation) continue;
    const citationParts = splitDcgisLegalAuthority(legislation);
    const identity = dcgisEntityIdentity(row, source.sourceId === "dcgis.agencies");
    if (!identity) continue;
    citationParts.forEach((citationText, index) => {
      const parsed = parseLegalReference(citationText);
      const lawTitleMatch = parsed.refType === "unknown"
        ? lawTitleIndex?.index.matchTitle(parsed.citationText)
        : undefined;
      const malformedActNumber = parsed.refType === "unknown"
        ? malformedDcActNumber(parsed.citationText)
        : undefined;
      const actSuggestionMatch = malformedActNumber
        ? actSuggestionIndex?.matches.get(malformedActNumber)
        : undefined;
      const idSuffix = citationParts.length === 1
        ? `${item.itemKey}-legislation`
        : `${item.itemKey}-legislation-${index + 1}`;
      legalRefs.push({
        legalRefId: buildLegalRefId(source.sourceId, idSuffix),
        sourceItemKey: item.itemKey,
        refType: lawTitleMatch ? "dc_law" : parsed.refType,
        citationText: parsed.citationText,
        normalizedCitation: lawTitleMatch?.citation ?? parsed.normalizedCitation,
        url: lawTitleMatch?.url ?? dcLawUrl(parsed.normalizedCitation) ??
          extractFirstUrl(citationText) ?? extractFirstUrl(legislation),
        needsReview: lawTitleMatch ? false : parsed.needsReview,
        suggestions: actSuggestionMatch
          ? [{
            refType: "dc_act",
            normalizedCitation: actSuggestionMatch.suggestion.actCitation,
            relatedCitation: actSuggestionMatch.suggestion.lawCitation,
            title: actSuggestionMatch.suggestion.title,
            url: actSuggestionMatch.suggestion.url,
            source: "DCCouncil law XML",
          }]
          : undefined,
        evidence: [
          fieldEvidence(legislationField, legislation, dcgisRowArtifactIndex(item)),
          ...(lawTitleMatch && lawTitleIndex
            ? [
              fieldEvidence(
                "DCCouncil law index",
                `${lawTitleMatch.citation}: ${lawTitleMatch.title}`,
                lawTitleIndex.artifactIndex,
              ),
            ]
            : []),
          ...(actSuggestionMatch
            ? [
              fieldEvidence(
                "DCCouncil law XML act suggestion",
                `${actSuggestionMatch.suggestion.actCitation} appears in ${actSuggestionMatch.suggestion.lawCitation}${
                  actSuggestionMatch.suggestion.title
                    ? `: ${actSuggestionMatch.suggestion.title}`
                    : ""
                }`,
                actSuggestionMatch.artifactIndex,
              ),
            ]
            : []),
        ],
        attachEntityRef: identity.entityRef,
      });
    });
  }
  return legalRefs;
}

function dcLawUrl(normalizedCitation?: string): string | undefined {
  const match = normalizedCitation?.match(/^D\.C\. Law ([0-9]{1,2})-([0-9]{1,4})$/);
  return match
    ? `https://code.dccouncil.gov/us/dc/council/laws/${match[1]}-${match[2]}`
    : undefined;
}

function splitDcgisLegalAuthority(value: string): string[] {
  const parts = value.split(";").map((part) => maybeString(part)).filter((part): part is string =>
    Boolean(part)
  );
  return parts.length > 1 ? parts : [value];
}

function dcgisRowArtifactIndex(item: SourceItemInput): number {
  return item.artifactIndex ?? 1;
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
