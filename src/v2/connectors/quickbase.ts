import {
  buildCandidateId,
  buildDatasetId,
  buildEntityId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type DatasetInput,
  detectEntityKind,
  type EntityCandidateInput,
  type RelationshipCandidateInput,
  type ReviewItemInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceFieldInput,
  type SourceItemInput,
} from "../domain.ts";
import {
  artifact,
  buildCandidateReviewItem,
  buildKnownEntityRef,
  type ConnectorContext,
  type ConnectorResult,
  fieldEvidence,
  maybeString,
  type SourceConnector,
} from "./shared.ts";

const quickbaseSource: SourceDefinition = {
  sourceId: "mota.quickbase",
  title: "MOTA Quickbase Public Surface",
  kind: "quickbase_csv_export",
  accessMethod: "official_quickbase_csv_export",
  baseUrl: "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0",
  notes:
    "Anonymous access includes a CSV export path (`dlta=xs`) for the appointments report plus app metadata on the base report page.",
};

const quickbaseColumns = {
  board: "board or commission - b or c",
  seat: "seat designation (specific role)",
  status: "appointment status",
  appointee: "appointee designation",
};

export const quickbaseConnector: SourceConnector = {
  sourceId: quickbaseSource.sourceId,
  source: quickbaseSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const overviewEndpoint: SourceEndpointDefinition = {
      endpointId: "mota.quickbase.overview",
      sourceId: quickbaseSource.sourceId,
      title: "Quickbase board and commission overview",
      kind: "page",
      url: quickbaseSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };

    const appointmentsEndpoint: SourceEndpointDefinition = {
      endpointId: "mota.quickbase.appointments_csv",
      sourceId: quickbaseSource.sourceId,
      title: "Quickbase board and commission appointments CSV",
      kind: "text",
      url: buildAppointmentsCsvUrl(quickbaseSource.baseUrl),
      method: "GET",
      captureMode: "text",
    };

    const overviewResponse = await context.fetcher(quickbaseSource.baseUrl);
    const overviewHtml = await overviewResponse.text();

    let appointmentsCsv = "";
    let appointmentsParsed: QuickbaseParseResult;
    try {
      const response = await context.fetcher(appointmentsEndpoint.url);
      appointmentsCsv = await response.text();
      appointmentsParsed = parseQuickbaseCsv(appointmentsCsv, context.limit);
    } catch (error) {
      return {
        source: quickbaseSource,
        endpointResults: [
          {
            endpoint: overviewEndpoint,
            status: "success",
            artifacts: [artifact("page", "html", quickbaseSource.baseUrl, overviewHtml)],
          },
          {
            endpoint: appointmentsEndpoint,
            status: "failed",
            errorText: error instanceof Error ? error.message : String(error),
            artifacts: [artifact("text", "csv", appointmentsEndpoint.url, appointmentsCsv)],
            parsed: {
              reviewItems: [
                {
                  reviewItemId: buildReviewItemId("mota.quickbase", "status"),
                  itemType: "source_status",
                  subjectId: quickbaseSource.sourceId,
                  reason:
                    "Quickbase appointments CSV endpoint failed to fetch without authentication.",
                  defaultAction: "defer",
                  details: {
                    testedUrls: [quickbaseSource.baseUrl, appointmentsEndpoint.url],
                    accessMethod: quickbaseSource.accessMethod,
                    failureMode: "fetch",
                  },
                },
              ],
            },
          },
        ],
      };
    }

    if (!appointmentsParsed.ok) {
      return {
        source: quickbaseSource,
        endpointResults: [
          {
            endpoint: overviewEndpoint,
            status: "success",
            artifacts: [artifact("page", "html", quickbaseSource.baseUrl, overviewHtml)],
          },
          {
            endpoint: appointmentsEndpoint,
            status: "failed",
            artifacts: [artifact("text", "csv", appointmentsEndpoint.url, appointmentsCsv)],
            errorText: appointmentsParsed.reason,
            parsed: {
              reviewItems: [
                {
                  reviewItemId: buildReviewItemId("mota.quickbase", "status"),
                  itemType: "source_status",
                  subjectId: quickbaseSource.sourceId,
                  reason: appointmentsParsed.reason,
                  defaultAction: "defer",
                  details: {
                    testedUrls: [quickbaseSource.baseUrl, appointmentsEndpoint.url],
                    accessMethod: quickbaseSource.accessMethod,
                    behaviorObserved: previewText(appointmentsCsv),
                  },
                },
              ],
            },
          },
        ],
      };
    }

    const parsed = deriveQuickbaseParsedOutput(appointmentsParsed.rows);

    return {
      source: quickbaseSource,
      endpointResults: [
        {
          endpoint: overviewEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", quickbaseSource.baseUrl, overviewHtml)],
        },
        {
          endpoint: appointmentsEndpoint,
          status: "success",
          artifacts: [artifact("text", "csv", appointmentsEndpoint.url, appointmentsCsv)],
          parsed,
        },
      ],
    };
  },
};

interface QuickbaseParseError {
  ok: false;
  reason: string;
}

interface QuickbaseParseSuccess {
  ok: true;
  rows: Array<Record<string, string>>;
}

type QuickbaseParseResult = QuickbaseParseError | QuickbaseParseSuccess;

function buildAppointmentsCsvUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("dlta", "xs");
  return url.toString();
}

function parseQuickbaseCsv(csvText: string, limit?: number): QuickbaseParseResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return {
      ok: false,
      reason: "CSV payload does not include a header and at least one appointment row.",
    };
  }

  const headers = rows[0].map((header) => normalizeHeader(header));
  if (headers.length === 0 || headers.every((header) => header.length === 0)) {
    return { ok: false, reason: "CSV payload header could not be extracted." };
  }

  const rowsByHeader: Array<Record<string, string>> = [];
  for (const row of rows.slice(1)) {
    const values: Record<string, string> = {};
    for (const [index, header] of headers.entries()) {
      values[header] = normalizeField(row[index] ?? "");
    }
    const hasAnyValue = headers.some((header) => values[header] !== "");
    if (!hasAnyValue) continue;
    rowsByHeader.push(values);
  }

  if (rowsByHeader.length === 0) {
    return { ok: false, reason: "CSV payload parsed to zero usable appointment rows." };
  }

  const limitedRows = typeof limit === "number" ? rowsByHeader.slice(0, limit) : rowsByHeader;
  return { ok: true, rows: limitedRows };
}

function normalizeField(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

function normalizeHeader(value: string): string {
  return normalizeField(value).toLowerCase();
}

interface QuickbaseParsedOutput {
  fields: SourceFieldInput[];
  items: SourceItemInput[];
  entityCandidates: EntityCandidateInput[];
  relationshipCandidates: RelationshipCandidateInput[];
  datasets?: DatasetInput[];
  reviewItems: ReviewItemInput[];
}

function deriveQuickbaseParsedOutput(rows: Array<Record<string, string>>): QuickbaseParsedOutput {
  const headers = Object.keys(rows[0] ?? {});
  const fields: SourceFieldInput[] = headers.map((fieldName, index) => ({
    fieldName,
    fieldType: "text",
    fieldLabel: fieldName,
    ordinal: index,
    artifactIndex: 0,
  }));

  const items: SourceItemInput[] = rows.map((row, index) => {
    const board = maybeString(row[quickbaseColumns.board]) ?? `row-${index + 1}`;
    return {
      itemKey: `row-${index + 1}`,
      itemType: "quickbase.appointment_record",
      title: board,
      artifactIndex: 0,
      body: {
        rowIndex: index + 1,
        board: row[quickbaseColumns.board] ?? "",
        seat: row[quickbaseColumns.seat] ?? "",
        appointmentStatus: row[quickbaseColumns.status] ?? "",
        appointeeDesignation: row[quickbaseColumns.appointee] ?? "",
        sourceRow: row,
      },
    };
  });

  const seenBoards = new Map<string, string>();
  const entityCandidates: EntityCandidateInput[] = [];
  const relationshipCandidates: RelationshipCandidateInput[] = [];
  const reviewItems: ReviewItemInput[] = [];
  const relationshipKeys = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const itemKey = `row-${index + 1}`;
    const board = maybeString(row[quickbaseColumns.board]);
    const seat = maybeString(row[quickbaseColumns.seat]) ?? "";
    const appointmentStatus = maybeString(row[quickbaseColumns.status]) ?? "unknown";
    const appointeeDesignation = maybeString(row[quickbaseColumns.appointee]) ?? "";

    if (!board) {
      continue;
    }

    const boardEntityId = buildEntityId(board);
    if (!seenBoards.has(board)) {
      seenBoards.set(board, "true");
      const candidateId = buildCandidateId(quickbaseSource.sourceId, board);
      const cluster = deriveQuickbaseCluster(board);
      const kind = detectEntityKind(undefined, board);
      entityCandidates.push({
        candidateId,
        sourceItemKey: itemKey,
        proposedEntityId: boardEntityId,
        name: board,
        kind,
        rawKind: kind,
        cluster,
        officialUrl: quickbaseSource.baseUrl,
        confidence: 0.95,
        duplicateHint: board,
        evidence: [
          fieldEvidence(quickbaseColumns.board, board),
          fieldEvidence("row", String(index + 1)),
        ],
      });
      reviewItems.push(
        buildCandidateReviewItem(
          candidateId,
          "Review MOTA board/commission identity and scope",
          "accept",
          {
            source: quickbaseSource.sourceId,
            name: board,
            kind,
            cluster,
            latestAppointmentStatus: appointmentStatus,
          },
        ),
      );
    }

    const governingAgency = parseGoverningAgencyFromSeat(seat);
    if (governingAgency) {
      const governingAgencyEntityId = buildKnownEntityRef(governingAgency);
      const relationshipKey = `${boardEntityId}>${governingAgencyEntityId}:governed_by`;
      if (!relationshipKeys.has(relationshipKey)) {
        relationshipKeys.add(relationshipKey);
        const relationshipCandidateId = buildRelationshipCandidateId(
          quickbaseSource.sourceId,
          `${board}-governed-by-${governingAgency}`,
        );
        const candidate: RelationshipCandidateInput = {
          relationshipCandidateId,
          sourceItemKey: itemKey,
          fromEntityRef: boardEntityId,
          toEntityRef: governingAgencyEntityId,
          relationshipType: "governed_by",
          rawValue: seat,
          needsReview: false,
          evidence: [
            fieldEvidence(quickbaseColumns.seat, seat),
            fieldEvidence("row", String(index + 1)),
            fieldEvidence(quickbaseColumns.appointee, appointeeDesignation),
          ],
        };
        relationshipCandidates.push(candidate);
        reviewItems.push({
          reviewItemId: buildReviewItemId(relationshipCandidateId, "governing-agency"),
          itemType: "relationship_candidate",
          subjectId: relationshipCandidateId,
          reason: "Review governing agency inferred from seat designation",
          defaultAction: "accept",
          details: {
            fromEntityRef: boardEntityId,
            toEntityRef: governingAgencyEntityId,
            relationshipType: candidate.relationshipType,
            rawValue: seat,
          },
        });
      }
    }

    if (isCommitteeLike(board)) {
      const councilEntityRef = buildKnownEntityRef("Council");
      const relationshipKey = `${boardEntityId}>${councilEntityRef}:overseen_by`;
      if (!relationshipKeys.has(relationshipKey)) {
        relationshipKeys.add(relationshipKey);
        const relationshipCandidateId = buildRelationshipCandidateId(
          quickbaseSource.sourceId,
          `${board}-overseen-by-dc-council`,
        );
        const candidate: RelationshipCandidateInput = {
          relationshipCandidateId,
          sourceItemKey: itemKey,
          fromEntityRef: boardEntityId,
          toEntityRef: councilEntityRef,
          relationshipType: "overseen_by",
          rawValue: board,
          needsReview: true,
          evidence: [fieldEvidence(quickbaseColumns.board, board)],
        };
        relationshipCandidates.push(candidate);
        reviewItems.push({
          reviewItemId: buildReviewItemId(relationshipCandidateId, "council-oversight"),
          itemType: "relationship_candidate",
          subjectId: relationshipCandidateId,
          reason: "Review potential council oversight relationship for committee",
          defaultAction: "defer",
          details: {
            fromEntityRef: boardEntityId,
            toEntityRef: councilEntityRef,
            relationshipType: candidate.relationshipType,
            rawValue: board,
          },
        });
      }
    }
  }

  const dataset: DatasetInput = {
    datasetId: buildDatasetId(quickbaseSource.sourceId, "appointments"),
    sourceItemKey: items[0]?.itemKey ?? "row-1",
    name: "MOTA board and commission appointments",
    category: "appointments",
    ownerName: "MOTA",
    accessMethod: quickbaseSource.accessMethod,
    artifactDepth: "records",
    officialUrl: buildAppointmentsCsvUrl(quickbaseSource.baseUrl),
    evidence: [fieldEvidence("rows", String(rows.length))],
  };

  return {
    fields,
    items,
    entityCandidates,
    relationshipCandidates,
    datasets: [dataset],
    reviewItems,
  };
}

function parseGoverningAgencyFromSeat(seat: string): string | undefined {
  const direct = maybeString(seat);
  if (!direct) return undefined;
  const trustedPrefix = extractTrustedSeatOrganizationPrefix(direct);
  const candidates = new Set(
    [
      extractParentheticalDesigneeOrganization(direct),
      stripSeatAcronymParens(
        stripSeatSubunitDetails(stripSeatRolePrefix(trustedPrefix ?? "")),
      ),
      stripSeatAcronymParens(stripSeatRolePrefix(trustedPrefix ?? "")),
      stripSeatAcronymParens(stripSeatSubunitDetails(trustedPrefix ?? "")),
      stripSeatAcronymParens(trustedPrefix ?? ""),
      stripSeatSubunitDetails(stripSeatRolePrefix(trustedPrefix ?? "")),
      stripSeatRolePrefix(trustedPrefix ?? ""),
      stripSeatSubunitDetails(trustedPrefix ?? ""),
      trustedPrefix,
    ].map((value) => maybeString(value)).filter((value): value is string => Boolean(value)),
  );
  for (const candidate of candidates) {
    if (isLikelyQuickbaseOrganization(candidate)) return candidate;
  }
  return undefined;
}

function extractParentheticalDesigneeOrganization(seat: string): string | undefined {
  const match = seat.match(/\(([^()]*?)\s+(?:or\s+)?designee\b[^()]*/i);
  return maybeString(match?.[1]);
}

function extractTrustedSeatOrganizationPrefix(seat: string): string | undefined {
  for (
    const pattern of [
      /\s+alternate designee\b.*$/i,
      /\s+alternate member\b.*$/i,
      /\s+principal member\b.*$/i,
      /\s+(?:or\s+)?designee\b.*$/i,
    ]
  ) {
    const prefix = maybeString(seat.replace(pattern, ""));
    if (prefix && prefix.length < seat.length) return prefix;
  }
  return undefined;
}

function stripSeatRolePrefix(value: string): string {
  const match = value.match(
    /^(?:director|executive director|chief executive officer|chair|chancellor|president|chief)\s+of(?:\s+the)?\s+(.+)$/i,
  );
  return maybeString(match?.[1]) ?? value;
}

function stripSeatSubunitDetails(value: string): string {
  return maybeString(value.replace(/\)\s*(?:,|-)\s*.*$/i, ")")) ?? value;
}

function stripSeatAcronymParens(value: string): string {
  return maybeString(value.replace(/\([^)]*\)/g, " ")) ?? value;
}

function isLikelyQuickbaseOrganization(value: string): boolean {
  if (buildKnownEntityRef(value) !== buildEntityId(value)) return true;
  return /\b(department|office|agency|administration|board|commission|council|committee|authority|university|library|district|mayor's office)\b/i
    .test(value);
}

function deriveQuickbaseCluster(board: string): string | undefined {
  if (/task force/i.test(board)) return "Task Force";
  if (/advisory committee/i.test(board)) return "Advisory Committee";
  if (/committee/i.test(board)) return "Committee";
  if (/commission/i.test(board)) return "Commission";
  if (/board/i.test(board)) return "Board";
  return undefined;
}

function isCommitteeLike(board: string): boolean {
  return /\bcommittee\b/i.test(board);
}

function previewText(input: string): string {
  return input.replaceAll("\n", " ").slice(0, 280);
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === "," || char === "\r" || char === "\n")) {
      row.push(field);
      field = "";
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      if (char === "\r" || char === "\n") {
        rows.push(row);
        row = [];
      }
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .filter((candidate) => candidate.length > 1 || candidate[0]?.trim()?.length)
    .map((candidate) => candidate.map((value) => value.trim()));
}
