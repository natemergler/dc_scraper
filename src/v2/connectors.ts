import {
  ArtifactCaptureInput,
  buildCandidateId,
  buildDatasetId,
  buildEntityId,
  buildLegalRefId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  ConnectorResult,
  DatasetInput,
  decodeHtmlEntities,
  detectEntityKind,
  EvidenceInput,
  LegalRefInput,
  normalizeName,
  parseLegalReference,
  RelationshipCandidateInput,
  ReviewItemInput,
  SourceDefinition,
  SourceEndpointDefinition,
  SourceFieldInput,
  SourceItemInput,
  stripHtml,
} from "./domain.ts";

export interface ConnectorFetchResponse {
  status: number;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<ConnectorFetchResponse>;

export interface ConnectorContext {
  fetcher: Fetcher;
  limit?: number;
}

export interface SourceConnector {
  sourceId: string;
  source: SourceDefinition;
  run(context: ConnectorContext): Promise<ConnectorResult>;
}

const dcgisAgenciesSource: SourceDefinition = {
  sourceId: "dcgis.agencies",
  title: "District Government Agencies",
  kind: "arcgis_table",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6",
};

const openDcSource: SourceDefinition = {
  sourceId: "open_dc.public_bodies",
  title: "Open DC Public Bodies",
  kind: "public_body_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://www.open-dc.gov/public-bodies",
};

const councilCommitteesSource: SourceDefinition = {
  sourceId: "council.committees",
  title: "Council Committees",
  kind: "committee_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://dccouncil.gov/committees/",
};

const councilLimsSource: SourceDefinition = {
  sourceId: "council.lims",
  title: "Council LIMS What's New",
  kind: "json_api",
  accessMethod: "official_json_api",
  baseUrl: "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
};

const quickbaseSource: SourceDefinition = {
  sourceId: "mota.quickbase",
  title: "MOTA Quickbase Public Surface",
  kind: "quickbase_app",
  accessMethod: "official_public_app_overview",
  baseUrl: "https://octo.quickbase.com/db/bjngwsngm?a=td",
  notes: "Anonymous app overview is public, but table/report access may still require sign-in.",
};

const legalEntrypointsSource: SourceDefinition = {
  sourceId: "legal.entrypoints",
  title: "DC Legal Entrypoints",
  kind: "legal_source_index",
  accessMethod: "official_page_html",
  baseUrl: "https://dc.gov/page/laws-regulations-and-courts",
};

const admin311Source: SourceDefinition = {
  sourceId: "admin.service_requests_311",
  title: "311 Service Requests",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Service_WebMercator/MapServer/33",
};

function defaultFetcher(url: string, init?: RequestInit): Promise<ConnectorFetchResponse> {
  return fetch(url, init) as Promise<ConnectorFetchResponse>;
}

function artifact(
  kind: ArtifactCaptureInput["kind"],
  extension: string,
  fetchedUrl: string,
  contentText: string,
): ArtifactCaptureInput {
  return { kind, extension, fetchedUrl, contentText };
}

function fieldEvidence(path: string, value: unknown): EvidenceInput {
  return { fieldPath: path, observedValue: String(value ?? "") };
}

function buildOpenDcReview(
  subjectId: string,
  reason: string,
  defaultAction = "accept",
): ReviewItemInput {
  return {
    reviewItemId: buildReviewItemId(subjectId, reason),
    itemType: subjectId.startsWith("relationship.") ? "relationship_candidate" : "entity_candidate",
    subjectId,
    reason,
    defaultAction,
    details: {},
  };
}

export const connectors: SourceConnector[] = [
  {
    sourceId: dcgisAgenciesSource.sourceId,
    source: dcgisAgenciesSource,
    async run(context): Promise<ConnectorResult> {
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
      const rows = Array.isArray(rowsPayload.features)
        ? rowsPayload.features.map((feature: Record<string, unknown>) => feature.attributes ?? {})
        : (rowsPayload.rows ?? []);
      const fields: SourceFieldInput[] = (metadata.fields ?? []).map(
        (field: Record<string, unknown>, index: number) => ({
          fieldName: String(field.name),
          fieldType: String(field.type ?? "unknown"),
          fieldLabel: String(field.alias ?? field.name),
          ordinal: index,
        }),
      );
      const items: SourceItemInput[] = rows.map((row: Record<string, unknown>) => ({
        itemKey: String(row.AGENCY_ID ?? row.OBJECTID),
        itemType: "agency_row",
        title: String(row.AGENCY_NAME ?? row.SHORT_NAME ?? row.OBJECTID),
        body: row,
      }));
      const entityCandidates = items.map((item) => {
        const row = item.body;
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
            fieldEvidence("AGENCY_NAME", row.AGENCY_NAME),
            fieldEvidence("TYPE", row.TYPE),
            fieldEvidence("WEB_URL", row.WEB_URL),
          ],
        };
      });
      const relationshipCandidates: RelationshipCandidateInput[] = [];
      for (const item of items) {
        const row = item.body;
        const name = String(row.AGENCY_NAME ?? item.title);
        const fromEntityRef = buildEntityId(name);
        const branch = maybeString(row.BRANCH);
        if (branch) {
          relationshipCandidates.push({
            relationshipCandidateId: buildRelationshipCandidateId(
              dcgisAgenciesSource.sourceId,
              `${item.itemKey}-branch`,
            ),
            sourceItemKey: item.itemKey,
            fromEntityRef,
            toEntityRef: buildEntityId(`${branch} Branch`),
            relationshipType: "part_of",
            rawValue: branch,
            evidence: [fieldEvidence("BRANCH", branch)],
          });
        }
      }
      const legalRefs: LegalRefInput[] = [];
      for (const item of items) {
        const row = item.body;
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
          evidence: [fieldEvidence("LEGISLATION", legislation)],
          attachEntityRef: buildEntityId(String(row.AGENCY_NAME ?? item.title)),
        });
      }
      const reviewItems: ReviewItemInput[] = [
        ...entityCandidates.map((candidate) =>
          buildOpenDcReview(candidate.candidateId, "Review agency candidate from DCGIS")
        ),
        ...relationshipCandidates.map((candidate) => ({
          reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "branch"),
          itemType: "relationship_candidate" as const,
          subjectId: candidate.relationshipCandidateId,
          reason: "Review agency relationship inferred from branch metadata",
          defaultAction: "accept",
          details: {},
        })),
      ];
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
  },
  {
    sourceId: openDcSource.sourceId,
    source: openDcSource,
    async run(context): Promise<ConnectorResult> {
      const indexEndpoint: SourceEndpointDefinition = {
        endpointId: "open_dc.public_bodies.index",
        sourceId: openDcSource.sourceId,
        title: "Open DC public bodies index",
        kind: "page",
        url: openDcSource.baseUrl,
        method: "GET",
        captureMode: "page",
      };
      const detailEndpoint: SourceEndpointDefinition = {
        endpointId: "open_dc.public_bodies.detail",
        sourceId: openDcSource.sourceId,
        title: "Open DC public body detail pages",
        kind: "page",
        url: openDcSource.baseUrl,
        method: "GET",
        captureMode: "documents",
      };
      const indexResponse = await context.fetcher(openDcSource.baseUrl);
      const indexHtml = await indexResponse.text();
      const links = parseOpenDcIndex(indexHtml).slice(0, context.limit ?? 8);
      const detailArtifacts: ArtifactCaptureInput[] = [];
      const items: SourceItemInput[] = [];
      const entityCandidates = [];
      const relationshipCandidates: RelationshipCandidateInput[] = [];
      const legalRefs: LegalRefInput[] = [];
      const reviewItems: ReviewItemInput[] = [];
      for (const link of links) {
        const detailUrl = toAbsoluteUrl(openDcSource.baseUrl, link.href);
        const detailResponse = await context.fetcher(detailUrl);
        const detailHtml = await detailResponse.text();
        detailArtifacts.push(artifact("page", "html", detailUrl, detailHtml));
        const detail = parseOpenDcDetail(detailHtml, detailUrl);
        const itemKey = detail.slug;
        items.push({
          itemKey,
          itemType: "public_body_detail",
          title: detail.name,
          body: {
            name: detail.name,
            slug: detail.slug,
            url: detailUrl,
            governingAgency: detail.governingAgency,
            enablingAuthority: detail.enablingAuthority,
            enablingAuthorityUrl: detail.enablingAuthorityUrl,
            meetingCount: detail.meetingCount,
          },
        });
        const candidateId = buildCandidateId(openDcSource.sourceId, itemKey);
        const proposedEntityId = buildEntityId(detail.name);
        entityCandidates.push({
          candidateId,
          sourceItemKey: itemKey,
          proposedEntityId,
          name: detail.name,
          kind: detectEntityKind(undefined, detail.name),
          rawKind: "public_body",
          officialUrl: detailUrl,
          confidence: 0.92,
          duplicateHint: detailUrl,
          evidence: [
            fieldEvidence("name", detail.name),
            fieldEvidence("url", detailUrl),
            fieldEvidence("governingAgency", detail.governingAgency ?? ""),
          ],
        });
        reviewItems.push(buildOpenDcReview(candidateId, "Review Open DC public body candidate"));
        if (detail.governingAgency) {
          const relationshipCandidateId = buildRelationshipCandidateId(
            openDcSource.sourceId,
            `${itemKey}-governing-agency`,
          );
          relationshipCandidates.push({
            relationshipCandidateId,
            sourceItemKey: itemKey,
            fromEntityRef: proposedEntityId,
            toEntityRef: buildEntityId(detail.governingAgency),
            relationshipType: "governed_by",
            rawValue: detail.governingAgency,
            evidence: [fieldEvidence("governingAgency", detail.governingAgency)],
          });
          reviewItems.push({
            reviewItemId: buildReviewItemId(relationshipCandidateId, "governing-agency"),
            itemType: "relationship_candidate",
            subjectId: relationshipCandidateId,
            reason: "Review governing agency relationship from Open DC",
            defaultAction: "accept",
            details: {},
          });
        }
        if (detail.enablingAuthority) {
          const parsed = parseLegalReference(detail.enablingAuthority, detail.enablingAuthorityUrl);
          legalRefs.push({
            legalRefId: buildLegalRefId(openDcSource.sourceId, `${itemKey}-authority`),
            sourceItemKey: itemKey,
            refType: parsed.refType,
            citationText: parsed.citationText,
            normalizedCitation: parsed.normalizedCitation,
            url: detail.enablingAuthorityUrl,
            needsReview: parsed.needsReview,
            evidence: [fieldEvidence("enablingAuthority", detail.enablingAuthority)],
            attachEntityRef: proposedEntityId,
          });
        }
      }
      return {
        source: openDcSource,
        endpointResults: [
          {
            endpoint: indexEndpoint,
            status: "success",
            artifacts: [artifact("page", "html", openDcSource.baseUrl, indexHtml)],
            parsed: {
              items: links.map((link) => ({
                itemKey: link.slug,
                itemType: "public_body_index",
                title: link.text,
                body: { href: toAbsoluteUrl(openDcSource.baseUrl, link.href) },
              })),
            },
          },
          {
            endpoint: detailEndpoint,
            status: "success",
            artifacts: detailArtifacts,
            parsed: {
              items,
              entityCandidates,
              relationshipCandidates,
              legalRefs,
              reviewItems,
            },
          },
        ],
      };
    },
  },
  {
    sourceId: councilCommitteesSource.sourceId,
    source: councilCommitteesSource,
    async run(context): Promise<ConnectorResult> {
      const endpoint: SourceEndpointDefinition = {
        endpointId: "council.committees.page",
        sourceId: councilCommitteesSource.sourceId,
        title: "Council committees page",
        kind: "page",
        url: councilCommitteesSource.baseUrl,
        method: "GET",
        captureMode: "page",
      };
      const response = await context.fetcher(councilCommitteesSource.baseUrl);
      const html = await response.text();
      const committees = parseCouncilCommittees(html);
      const items: SourceItemInput[] = committees.map((committee) => ({
        itemKey: committee.slug,
        itemType: "committee_page",
        title: committee.name,
        body: committee,
      }));
      const entityCandidates = committees.map((committee) => ({
        candidateId: buildCandidateId(councilCommitteesSource.sourceId, committee.slug),
        sourceItemKey: committee.slug,
        proposedEntityId: buildEntityId(committee.name),
        name: committee.name,
        kind: "committee",
        rawKind: "committee",
        officialUrl: committee.url,
        confidence: 0.95,
        duplicateHint: committee.url,
        evidence: [fieldEvidence("committee", committee.name)],
      }));
      const relationshipCandidates: RelationshipCandidateInput[] = committees.map((committee) => ({
        relationshipCandidateId: buildRelationshipCandidateId(
          councilCommitteesSource.sourceId,
          `${committee.slug}-part-of`,
        ),
        sourceItemKey: committee.slug,
        fromEntityRef: buildEntityId(committee.name),
        toEntityRef: "dc.council",
        relationshipType: "part_of",
        rawValue: "Council committee",
        evidence: [fieldEvidence("committee", committee.name)],
      }));
      const reviewItems: ReviewItemInput[] = [
        ...entityCandidates.map((candidate) =>
          buildOpenDcReview(candidate.candidateId, "Review Council committee candidate")
        ),
        ...relationshipCandidates.map((candidate) => ({
          reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "committee"),
          itemType: "relationship_candidate" as const,
          subjectId: candidate.relationshipCandidateId,
          reason: "Review committee to Council relationship",
          defaultAction: "accept",
          details: {},
        })),
      ];
      return {
        source: councilCommitteesSource,
        endpointResults: [{
          endpoint,
          status: "success",
          artifacts: [artifact("page", "html", councilCommitteesSource.baseUrl, html)],
          parsed: {
            items,
            entityCandidates,
            relationshipCandidates,
            reviewItems,
          },
        }],
      };
    },
  },
  {
    sourceId: councilLimsSource.sourceId,
    source: councilLimsSource,
    async run(context): Promise<ConnectorResult> {
      const endpoint: SourceEndpointDefinition = {
        endpointId: "council.lims.whats_new",
        sourceId: councilLimsSource.sourceId,
        title: "Council LIMS what's new",
        kind: "json",
        url: councilLimsSource.baseUrl,
        method: "GET",
        captureMode: "sample",
      };
      const response = await context.fetcher(councilLimsSource.baseUrl);
      const payloadText = await response.text();
      const payload = JSON.parse(payloadText);
      const items: SourceItemInput[] = payload.map((row: Record<string, unknown>) => ({
        itemKey: String(row.legislationNumber ?? row.legislationId),
        itemType: "lims_legislation_item",
        title: String(row.title ?? row.legislationNumber),
        body: row,
      }));
      const dataset: DatasetInput = {
        datasetId: buildDatasetId(councilLimsSource.sourceId, "whats-new"),
        sourceItemKey: items[0]?.itemKey ?? "whats-new",
        name: "Council LIMS What's New feed",
        category: "legislative",
        ownerName: "Council of the District of Columbia",
        accessMethod: councilLimsSource.accessMethod,
        artifactDepth: "sample",
        officialUrl: councilLimsSource.baseUrl,
        evidence: [fieldEvidence("endpoint", councilLimsSource.baseUrl)],
      };
      return {
        source: councilLimsSource,
        endpointResults: [{
          endpoint,
          status: "success",
          artifacts: [artifact("sample", "json", councilLimsSource.baseUrl, payloadText)],
          parsed: {
            items,
            datasets: [dataset],
          },
        }],
      };
    },
  },
  {
    sourceId: quickbaseSource.sourceId,
    source: quickbaseSource,
    async run(context): Promise<ConnectorResult> {
      const endpoint: SourceEndpointDefinition = {
        endpointId: "mota.quickbase.app",
        sourceId: quickbaseSource.sourceId,
        title: "Quickbase public app overview",
        kind: "page",
        url: quickbaseSource.baseUrl,
        method: "GET",
        captureMode: "page",
      };
      const response = await context.fetcher(quickbaseSource.baseUrl);
      const html = await response.text();
      const feasible = parseQuickbaseFeasibility(html);
      return {
        source: quickbaseSource,
        endpointResults: [{
          endpoint,
          status: feasible.feasible ? "success" : "failed",
          errorText: feasible.reason,
          artifacts: [artifact("page", "html", quickbaseSource.baseUrl, html)],
          parsed: feasible.feasible ? undefined : {
            reviewItems: [{
              reviewItemId: buildReviewItemId("mota.quickbase", "status"),
              itemType: "source_status",
              subjectId: "mota.quickbase",
              reason: feasible.reason,
              defaultAction: "defer",
              details: { access: "anonymous-overview-only" },
            }],
          },
        }],
      };
    },
  },
  {
    sourceId: legalEntrypointsSource.sourceId,
    source: legalEntrypointsSource,
    async run(context): Promise<ConnectorResult> {
      const endpoint: SourceEndpointDefinition = {
        endpointId: "legal.entrypoints.main",
        sourceId: legalEntrypointsSource.sourceId,
        title: "DC legal entrypoints page",
        kind: "page",
        url: legalEntrypointsSource.baseUrl,
        method: "GET",
        captureMode: "page",
      };
      const response = await context.fetcher(legalEntrypointsSource.baseUrl);
      const html = await response.text();
      const sources = parseLegalEntrypoints(html);
      const items: SourceItemInput[] = sources.map((source) => ({
        itemKey: source.slug,
        itemType: "legal_source_entry",
        title: source.name,
        body: source,
      }));
      return {
        source: legalEntrypointsSource,
        endpointResults: [{
          endpoint,
          status: "success",
          artifacts: [artifact("page", "html", legalEntrypointsSource.baseUrl, html)],
          parsed: {
            items,
            datasets: sources.map((source) => ({
              datasetId: buildDatasetId(legalEntrypointsSource.sourceId, source.slug),
              sourceItemKey: source.slug,
              name: source.name,
              category: "legal_source",
              ownerName: "District of Columbia",
              accessMethod: "official_page_html",
              artifactDepth: "page",
              officialUrl: source.url,
              evidence: [fieldEvidence("link", source.url)],
            })),
          },
        }],
      };
    },
  },
  {
    sourceId: admin311Source.sourceId,
    source: admin311Source,
    async run(context): Promise<ConnectorResult> {
      const endpoint: SourceEndpointDefinition = {
        endpointId: "admin.service_requests_311.main",
        sourceId: admin311Source.sourceId,
        title: "311 service requests dataset metadata",
        kind: "arcgis_table",
        url: admin311Source.baseUrl,
        method: "GET",
        captureMode: "schema",
      };
      const metadataUrl = `${admin311Source.baseUrl}?f=json`;
      const response = await context.fetcher(metadataUrl);
      const text = await response.text();
      const payload = JSON.parse(text);
      const fields: SourceFieldInput[] = (payload.fields ?? []).map(
        (field: Record<string, unknown>, index: number) => ({
          fieldName: String(field.name),
          fieldType: String(field.type ?? "unknown"),
          fieldLabel: String(field.alias ?? field.name),
          ordinal: index,
        }),
      );
      const item: SourceItemInput = {
        itemKey: "schema",
        itemType: "dataset_schema",
        title: String(payload.name ?? "311 Service Requests"),
        body: payload,
      };
      const dataset: DatasetInput = {
        datasetId: buildDatasetId(admin311Source.sourceId, "schema"),
        sourceItemKey: "schema",
        name: String(payload.name ?? "311 Service Requests"),
        category: "service_requests",
        ownerName: "District of Columbia",
        accessMethod: admin311Source.accessMethod,
        artifactDepth: "schema",
        officialUrl: admin311Source.baseUrl,
        evidence: [fieldEvidence("field_count", fields.length)],
      };
      return {
        source: admin311Source,
        endpointResults: [{
          endpoint,
          status: "success",
          artifacts: [artifact("schema", "json", metadataUrl, text)],
          parsed: {
            fields,
            items: [item],
            datasets: [dataset],
          },
        }],
      };
    },
  },
];

export function getConnector(sourceId: string): SourceConnector {
  const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
  if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
  return connector;
}

export function createConnectorContext(
  options: { fetcher?: Fetcher; limit?: number },
): ConnectorContext {
  return {
    fetcher: options.fetcher ?? defaultFetcher,
    limit: options.limit,
  };
}

function parseOpenDcIndex(html: string): Array<{ href: string; text: string; slug: string }> {
  const matches = [...html.matchAll(/<a href="(\/public-bodies\/[^"#?]+)"[^>]*>(.*?)<\/a>/gsi)];
  const seen = new Set<string>();
  const results: Array<{ href: string; text: string; slug: string }> = [];
  for (const match of matches) {
    const href = match[1];
    const text = normalizeName(stripHtml(match[2]));
    if (!href.startsWith("/public-bodies/")) continue;
    if (href.includes("/meetings")) continue;
    if (!text || text === "Public Bodies") continue;
    if (seen.has(href)) continue;
    seen.add(href);
    results.push({ href, text, slug: href.split("/").pop() ?? href });
  }
  return results;
}

function parseOpenDcDetail(
  html: string,
  detailUrl: string,
): {
  slug: string;
  name: string;
  governingAgency?: string;
  enablingAuthority?: string;
  enablingAuthorityUrl?: string;
  meetingCount: number;
} {
  const slug = detailUrl.split("/").pop() ?? detailUrl;
  const name = captureSingle(html, /<h1 class="page-title">([^<]+)<\/h1>/i) ?? slug;
  const enablingBlock = captureSingle(
    html,
    /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even"><a href="([^"]+)">([\s\S]*?)<\/a>/i,
    0,
  );
  const enablingAuthorityUrl = enablingBlock
    ? captureSingle(enablingBlock, /href="([^"]+)"/i)
    : undefined;
  const enablingAuthority = captureSingle(
    html,
    /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even"><a [^>]+>([\s\S]*?)<\/a>/i,
  );
  const governingAgency = captureSingle(
    html,
    /Governing Agency \/ Agency Acronym:[\s\S]*?<div class="field-items"><div class="field-item even">([\s\S]*?)<\/div>/i,
  );
  const meetingCount = [...html.matchAll(/class="view-meetings-calendar"/g)].length;
  return {
    slug,
    name: normalizeName(stripHtml(name)),
    governingAgency: governingAgency ? normalizeName(stripHtml(governingAgency)) : undefined,
    enablingAuthority: enablingAuthority ? normalizeName(stripHtml(enablingAuthority)) : undefined,
    enablingAuthorityUrl,
    meetingCount,
  };
}

function parseCouncilCommittees(html: string): Array<{ slug: string; name: string; url: string }> {
  const matches = [
    ...html.matchAll(/<a href="(https:\/\/dccouncil\.gov\/committees\/[^"]+)"[^>]*>(.*?)<\/a>/gsi),
  ];
  const seen = new Set<string>();
  const results: Array<{ slug: string; name: string; url: string }> = [];
  for (const match of matches) {
    const url = match[1];
    const name = normalizeName(stripHtml(match[2]));
    if (!name || name.startsWith("Committees")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      slug: url.replaceAll(/\/+$/g, "").split("/").pop() ?? name,
      name,
      url,
    });
  }
  return results;
}

function parseQuickbaseFeasibility(html: string): { feasible: boolean; reason: string } {
  if (html.includes("Sign in") && html.includes("EOM - MOTA Dashboard")) {
    return {
      feasible: false,
      reason:
        "Anonymous access currently reaches the Quickbase app overview, but public table/report data access was not discovered without sign-in.",
    };
  }
  return {
    feasible: true,
    reason: "Anonymous Quickbase access appears available.",
  };
}

function parseLegalEntrypoints(html: string): Array<{ slug: string; name: string; url: string }> {
  const matches = [...html.matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/gsi)];
  const results: Array<{ slug: string; name: string; url: string }> = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const url = toAbsoluteUrl(legalEntrypointsSource.baseUrl, match[1]);
    const name = normalizeName(stripHtml(match[2]));
    if (!name) continue;
    if (
      !/Official Code|Mayor'?s Orders|Laws, Regulations and Courts|DCMR|Register/i.test(name) &&
      !/code\.dccouncil\.gov|dcregs\.dc\.gov|mayor\.dc\.gov/.test(url)
    ) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      slug: url.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase(),
      name,
      url,
    });
  }
  return results;
}

function captureSingle(text: string, pattern: RegExp, group = 1): string | undefined {
  const match = text.match(pattern);
  return match?.[group];
}

function toAbsoluteUrl(baseUrl: string, maybeRelative: string): string {
  return new URL(maybeRelative, baseUrl).toString();
}

function extractFirstUrl(input: string): string | undefined {
  return input.match(/https?:\/\/\S+/)?.[0];
}

function maybeString(value: unknown): string | undefined {
  const text = typeof value === "string"
    ? normalizeName(decodeHtmlEntities(value))
    : String(value ?? "").trim();
  return text ? text : undefined;
}
