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
  tier: "tier1",
  releaseRole: "appointments",
  smokeProfiles: ["structure"],
  privacyNotes: [
    "Contact columns are explicitly out of scope; keep only public appointment structure and observations.",
  ],
};

const quickbaseColumns = {
  prefix: "prefix",
  firstName: "first name",
  lastName: "last name",
  suffix: "suffix",
  board: "board or commission - b or c",
  seat: "seat designation (specific role)",
  status: "appointment status",
  appointee: "appointee designation",
};

const quickbaseSafeSeededAuthorityEndpoints = new Set([
  "university of the district of columbia community college",
  "office of budget and performance management",
  "office of the chief of staff",
]);

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
    const publicAppointeeName = derivePublicAppointeeName(row)?.name ?? "";
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
        publicAppointeeName,
        sourceRow: row,
      },
    };
  });

  const seenBoards = new Map<string, string>();
  const seenSeats = new Set<string>();
  const seenStatuses = new Set<string>();
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

    const seatRecord = buildSeatRecord(board, seat);
    const statusRecord = buildSeatStatusRecord(appointmentStatus);
    const appointeeObservationRecord = buildAppointeeObservationRecord(
      index + 1,
      board,
      seatRecord,
      row,
    );
    if (seatRecord && !seenSeats.has(seatRecord.entityId)) {
      seenSeats.add(seatRecord.entityId);
      entityCandidates.push({
        candidateId: seatRecord.candidateId,
        sourceItemKey: itemKey,
        proposedEntityId: seatRecord.entityId,
        name: seatRecord.name,
        kind: "seat",
        rawKind: "seat",
        cluster: "Seat",
        officialUrl: quickbaseSource.baseUrl,
        confidence: 0.9,
        duplicateHint: `${board}::${seatRecord.label}`,
        evidence: [
          fieldEvidence(quickbaseColumns.seat, seatRecord.rawValue),
          fieldEvidence(quickbaseColumns.status, appointmentStatus),
          fieldEvidence("row", String(index + 1)),
        ],
      });
      reviewItems.push(
        buildCandidateReviewItem(
          seatRecord.candidateId,
          "Review MOTA public-body seat identity",
          "accept",
          {
            source: quickbaseSource.sourceId,
            board,
            seatLabel: seatRecord.label,
            seatDesignation: seatRecord.rawValue,
            appointmentStatus,
          },
        ),
      );
    }

    if (statusRecord && !seenStatuses.has(statusRecord.entityId)) {
      seenStatuses.add(statusRecord.entityId);
      entityCandidates.push({
        candidateId: statusRecord.candidateId,
        sourceItemKey: itemKey,
        proposedEntityId: statusRecord.entityId,
        name: statusRecord.name,
        kind: "appointment_status",
        rawKind: "appointment_status",
        cluster: "Appointment Status",
        confidence: 0.99,
        duplicateHint: statusRecord.name,
        evidence: [
          fieldEvidence(quickbaseColumns.status, statusRecord.rawValue),
          fieldEvidence("row", String(index + 1)),
        ],
      });
      reviewItems.push(
        buildCandidateReviewItem(
          statusRecord.candidateId,
          "Review MOTA appointment status vocabulary",
          "accept",
          {
            source: quickbaseSource.sourceId,
            status: statusRecord.name,
          },
        ),
      );
    }

    if (seatRecord) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        quickbaseSource.sourceId,
        `${board}-has-seat-${seatRecord.label}`,
      );
      const relationshipKey = `${boardEntityId}>${seatRecord.entityId}:has_seat`;
      if (!relationshipKeys.has(relationshipKey)) {
        relationshipKeys.add(relationshipKey);
        const candidate: RelationshipCandidateInput = {
          relationshipCandidateId,
          sourceItemKey: itemKey,
          fromEntityRef: boardEntityId,
          toEntityRef: seatRecord.entityId,
          relationshipType: "has_seat",
          rawValue: seat,
          needsReview: false,
          evidence: [
            fieldEvidence(quickbaseColumns.seat, seat),
            fieldEvidence("row", String(index + 1)),
            fieldEvidence(quickbaseColumns.status, appointmentStatus),
          ],
        };
        relationshipCandidates.push(candidate);
        reviewItems.push({
          reviewItemId: buildReviewItemId(relationshipCandidateId, "seat-structure"),
          itemType: "relationship_candidate",
          subjectId: relationshipCandidateId,
          reason: "Review public-body seat structure from Quickbase appointment row",
          defaultAction: "accept",
          details: {
            fromEntityRef: boardEntityId,
            toEntityRef: seatRecord.entityId,
            relationshipType: candidate.relationshipType,
            rawValue: seat,
            appointmentStatus,
          },
        });
      }
    }

    if (seatRecord && statusRecord) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        quickbaseSource.sourceId,
        `${seatRecord.name}-has-status-${statusRecord.name}`,
      );
      const relationshipKey = `${seatRecord.entityId}>${statusRecord.entityId}:has_status`;
      if (!relationshipKeys.has(relationshipKey)) {
        relationshipKeys.add(relationshipKey);
        const candidate: RelationshipCandidateInput = {
          relationshipCandidateId,
          sourceItemKey: itemKey,
          fromEntityRef: seatRecord.entityId,
          toEntityRef: statusRecord.entityId,
          relationshipType: "has_status",
          rawValue: statusRecord.rawValue,
          needsReview: true,
          evidence: [
            fieldEvidence(quickbaseColumns.status, statusRecord.rawValue),
            fieldEvidence("row", String(index + 1)),
            fieldEvidence(quickbaseColumns.seat, seat),
          ],
        };
        relationshipCandidates.push(candidate);
        reviewItems.push({
          reviewItemId: buildReviewItemId(relationshipCandidateId, "seat-status"),
          itemType: "relationship_candidate",
          subjectId: relationshipCandidateId,
          reason: "Review seat status from Quickbase appointment row",
          defaultAction: "accept",
          details: {
            fromEntityRef: seatRecord.entityId,
            toEntityRef: statusRecord.entityId,
            relationshipType: candidate.relationshipType,
            rawValue: statusRecord.rawValue,
            seatDesignation: seatRecord.rawValue,
          },
        });
      }
    }

    if (appointeeObservationRecord) {
      entityCandidates.push({
        candidateId: appointeeObservationRecord.candidateId,
        sourceItemKey: itemKey,
        proposedEntityId: appointeeObservationRecord.entityId,
        name: appointeeObservationRecord.name,
        kind: "appointee_observation",
        rawKind: "appointee_observation",
        cluster: "Appointment Observation",
        confidence: 0.9,
        duplicateHint: `${board}::${appointeeObservationRecord.name}`,
        evidence: appointeeObservationRecord.evidence,
      });
      reviewItems.push(
        buildCandidateReviewItem(
          appointeeObservationRecord.candidateId,
          "Review public appointee observation from Quickbase appointment row",
          "accept",
          {
            source: quickbaseSource.sourceId,
            board,
            publicAppointeeName: appointeeObservationRecord.name,
            appointmentStatus,
            seatDesignation: seat,
          },
        ),
      );
    }

    if (appointeeObservationRecord && seatRecord) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        quickbaseSource.sourceId,
        `${appointeeObservationRecord.entityId}-holds-${seatRecord.entityId}`,
      );
      const relationshipKey = `${appointeeObservationRecord.entityId}>${seatRecord.entityId}:holds`;
      if (!relationshipKeys.has(relationshipKey)) {
        relationshipKeys.add(relationshipKey);
        const candidate: RelationshipCandidateInput = {
          relationshipCandidateId,
          sourceItemKey: itemKey,
          fromEntityRef: appointeeObservationRecord.entityId,
          toEntityRef: seatRecord.entityId,
          relationshipType: "holds",
          rawValue: seatRecord.rawValue,
          needsReview: true,
          evidence: [
            ...appointeeObservationRecord.evidence,
            fieldEvidence(quickbaseColumns.seat, seatRecord.rawValue),
            fieldEvidence(quickbaseColumns.status, appointmentStatus),
          ],
        };
        relationshipCandidates.push(candidate);
        reviewItems.push({
          reviewItemId: buildReviewItemId(relationshipCandidateId, "appointee-seat"),
          itemType: "relationship_candidate",
          subjectId: relationshipCandidateId,
          reason:
            "Review public appointee observation holding a seat from Quickbase appointment row",
          defaultAction: "accept",
          details: {
            fromEntityRef: appointeeObservationRecord.entityId,
            toEntityRef: seatRecord.entityId,
            relationshipType: candidate.relationshipType,
            rawValue: seatRecord.rawValue,
            appointmentStatus,
          },
        });
      }
    }

    if (appointeeObservationRecord && statusRecord) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        quickbaseSource.sourceId,
        `${appointeeObservationRecord.entityId}-has-status-${statusRecord.entityId}`,
      );
      const relationshipKey =
        `${appointeeObservationRecord.entityId}>${statusRecord.entityId}:has_status`;
      if (!relationshipKeys.has(relationshipKey)) {
        relationshipKeys.add(relationshipKey);
        const candidate: RelationshipCandidateInput = {
          relationshipCandidateId,
          sourceItemKey: itemKey,
          fromEntityRef: appointeeObservationRecord.entityId,
          toEntityRef: statusRecord.entityId,
          relationshipType: "has_status",
          rawValue: statusRecord.rawValue,
          needsReview: true,
          evidence: [
            ...appointeeObservationRecord.evidence,
            fieldEvidence(quickbaseColumns.status, statusRecord.rawValue),
            fieldEvidence(quickbaseColumns.seat, seat),
          ],
        };
        relationshipCandidates.push(candidate);
        reviewItems.push({
          reviewItemId: buildReviewItemId(relationshipCandidateId, "appointee-status"),
          itemType: "relationship_candidate",
          subjectId: relationshipCandidateId,
          reason: "Review public appointee observation status from Quickbase appointment row",
          defaultAction: "accept",
          details: {
            fromEntityRef: appointeeObservationRecord.entityId,
            toEntityRef: statusRecord.entityId,
            relationshipType: candidate.relationshipType,
            rawValue: statusRecord.rawValue,
            seatDesignation: seat,
          },
        });
      }
    }

    for (const authority of parseSeatAuthorities(seat, appointeeDesignation)) {
      if (!seatRecord) continue;
      const authorityEntityId = buildKnownEntityRef(authority.authorityName);
      const relationshipKey =
        `${seatRecord.entityId}>${authorityEntityId}:${authority.relationshipType}`;
      if (relationshipKeys.has(relationshipKey)) {
        continue;
      }
      relationshipKeys.add(relationshipKey);
      const relationshipCandidateId = buildRelationshipCandidateId(
        quickbaseSource.sourceId,
        `${seatRecord.name}-${authority.relationshipType}-${authority.authorityName}`,
      );
      const candidate: RelationshipCandidateInput = {
        relationshipCandidateId,
        sourceItemKey: itemKey,
        fromEntityRef: seatRecord.entityId,
        toEntityRef: authorityEntityId,
        toEntityName: authority.authorityName,
        toEntitySafeToAutoAccept: isSafeQuickbaseSeededAuthorityEndpoint(
          authority.authorityName,
          appointeeDesignation,
        ),
        relationshipType: authority.relationshipType,
        rawValue: authority.rawValue,
        needsReview: true,
        evidence: [
          fieldEvidence(authority.evidenceFieldPath, authority.rawValue),
          fieldEvidence("row", String(index + 1)),
          fieldEvidence(quickbaseColumns.status, appointmentStatus),
        ],
      };
      relationshipCandidates.push(candidate);
      reviewItems.push({
        reviewItemId: buildReviewItemId(relationshipCandidateId, "seat-authority"),
        itemType: "relationship_candidate",
        subjectId: relationshipCandidateId,
        reason:
          "Review appointing or designating authority inferred from Quickbase appointment row",
        defaultAction: "accept",
        details: {
          fromEntityRef: seatRecord.entityId,
          toEntityRef: authorityEntityId,
          relationshipType: candidate.relationshipType,
          rawValue: authority.rawValue,
          appointmentStatus,
        },
      });
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

interface QuickbaseSeatRecord {
  candidateId: string;
  entityId: string;
  label: string;
  name: string;
  rawValue: string;
}

interface QuickbaseSeatStatusRecord {
  candidateId: string;
  entityId: string;
  name: string;
  rawValue: string;
}

interface SeatAuthorityRecord {
  relationshipType: "appointed_by" | "designated_by";
  authorityName: string;
  rawValue: string;
  evidenceFieldPath: string;
}

interface AppointeeNameRecord {
  name: string;
  evidence: Array<ReturnType<typeof fieldEvidence>>;
}

interface QuickbaseAppointeeObservationRecord {
  candidateId: string;
  entityId: string;
  name: string;
  evidence: Array<ReturnType<typeof fieldEvidence>>;
}

function buildSeatRecord(board: string, seat: string): QuickbaseSeatRecord | undefined {
  const rawValue = maybeString(seat);
  if (!rawValue) return undefined;
  const label = extractSeatLabel(rawValue);
  const entityName = `${board} ${label}`.replaceAll(/\s+/g, " ").trim();
  return {
    candidateId: buildCandidateId(quickbaseSource.sourceId, `${board}-seat-${label}`),
    entityId: buildEntityId(entityName),
    label,
    name: entityName,
    rawValue,
  };
}

function buildSeatStatusRecord(status: string): QuickbaseSeatStatusRecord | undefined {
  const rawValue = maybeString(status);
  if (!rawValue) return undefined;
  return {
    candidateId: buildCandidateId(quickbaseSource.sourceId, `appointment-status-${rawValue}`),
    entityId: buildEntityId(rawValue, "status"),
    name: rawValue,
    rawValue,
  };
}

function buildAppointeeObservationRecord(
  rowIndex: number,
  board: string,
  seatRecord: QuickbaseSeatRecord | undefined,
  row: Record<string, string>,
): QuickbaseAppointeeObservationRecord | undefined {
  const appointeeName = derivePublicAppointeeName(row);
  if (!appointeeName) return undefined;
  const rawKey = `${board}-row-${rowIndex}-${appointeeName.name}`;
  const entityBase = `${board} row ${rowIndex} ${appointeeName.name}`;
  const seatEvidence = seatRecord
    ? [fieldEvidence(quickbaseColumns.seat, seatRecord.rawValue)]
    : [];
  return {
    candidateId: buildCandidateId(quickbaseSource.sourceId, `appointee-observation-${rawKey}`),
    entityId: buildEntityId(entityBase, "observation"),
    name: appointeeName.name,
    evidence: [...appointeeName.evidence, ...seatEvidence, fieldEvidence("row", String(rowIndex))],
  };
}

function derivePublicAppointeeName(row: Record<string, string>): AppointeeNameRecord | undefined {
  const prefix = maybeString(row[quickbaseColumns.prefix]);
  const firstName = maybeString(row[quickbaseColumns.firstName]);
  const lastName = maybeString(row[quickbaseColumns.lastName]);
  const suffix = maybeString(row[quickbaseColumns.suffix]);
  const parts = [prefix, firstName, lastName, suffix].filter((value): value is string =>
    Boolean(value)
  );
  if (parts.length > 0) {
    return {
      name: parts.join(" "),
      evidence: [
        ...(prefix ? [fieldEvidence(quickbaseColumns.prefix, prefix)] : []),
        ...(firstName ? [fieldEvidence(quickbaseColumns.firstName, firstName)] : []),
        ...(lastName ? [fieldEvidence(quickbaseColumns.lastName, lastName)] : []),
        ...(suffix ? [fieldEvidence(quickbaseColumns.suffix, suffix)] : []),
      ],
    };
  }

  const fallback = maybeString(row[quickbaseColumns.appointee]);
  if (!fallback || !looksLikePublicAppointeeName(fallback)) {
    return undefined;
  }
  return {
    name: fallback,
    evidence: [fieldEvidence(quickbaseColumns.appointee, fallback)],
  };
}

function looksLikePublicAppointeeName(value: string): boolean {
  if (/[,@]/.test(value)) return false;
  if (/\b(appointee|representative|member|designee|agency)\b/i.test(value)) return false;
  return /[A-Za-z]/.test(value) && /\s/.test(value);
}

function parseSeatAuthorities(
  seat: string,
  appointeeDesignation: string,
): SeatAuthorityRecord[] {
  const authorities: SeatAuthorityRecord[] = [];
  const designatedBy = parseDesignatingAuthorityFromSeat(seat);
  if (designatedBy) {
    authorities.push({
      relationshipType: "designated_by",
      authorityName: designatedBy,
      rawValue: seat,
      evidenceFieldPath: quickbaseColumns.seat,
    });
  }
  const appointedBy = parseAppointingAuthority(seat, appointeeDesignation);
  if (appointedBy) {
    authorities.push(appointedBy);
  }
  return authorities;
}

function extractSeatLabel(seat: string): string {
  const withoutParens = seat.replace(/\([^)]*\)/g, " ").replaceAll(/\s+/g, " ").trim();
  return withoutParens || seat.trim();
}

function parseDesignatingAuthorityFromSeat(seat: string): string | undefined {
  const rawValue = maybeString(seat);
  if (!rawValue || !/\bdesignee\b/i.test(rawValue)) return undefined;
  const organization = parseDesignatingOrganizationFromSeat(rawValue);
  if (organization) {
    return normalizeAuthorityName(organization);
  }
  const withoutDesignee = rawValue.replace(/\bdesignee\b/gi, "").replaceAll(/\s+/g, " ").trim();
  const mayor = normalizeAuthorityName(withoutDesignee);
  return mayor === "Mayor" ? mayor : undefined;
}

function parseAppointingAuthority(
  seat: string,
  appointeeDesignation: string,
): SeatAuthorityRecord | undefined {
  for (
    const [rawValue, evidenceFieldPath] of [
      [maybeString(appointeeDesignation), quickbaseColumns.appointee],
      [maybeString(seat), quickbaseColumns.seat],
    ] as const
  ) {
    if (!rawValue) continue;
    const mayorMatch = rawValue.match(/\bMayoral Appointee\b/i);
    if (mayorMatch) {
      return {
        relationshipType: "appointed_by",
        authorityName: "Mayor",
        rawValue: mayorMatch[0],
        evidenceFieldPath,
      };
    }
    const councilMatch = rawValue.match(/\bCouncil(?:member)? Appointee\b/i);
    if (councilMatch) {
      return {
        relationshipType: "appointed_by",
        authorityName: "Council",
        rawValue: councilMatch[0],
        evidenceFieldPath,
      };
    }
  }
  return undefined;
}

function normalizeAuthorityName(value: string): string | undefined {
  let normalized = maybeString(value);
  if (!normalized) return undefined;
  for (
    const prefix of [
      "Director of the ",
      "Director of ",
      "Executive Director of ",
      "Chief Executive Officer of ",
    ]
  ) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      normalized = normalized.slice(prefix.length).trim();
      break;
    }
  }
  normalized = normalized.replace(/\s+\([^)]*\)\s*/g, " ").trim();
  normalized = normalized.replace(/^the\s+/i, "").trim();
  normalized = normalized.replace(/^mayor['’]s$/i, "Mayor").trim();
  normalized = normalized.replace(/\bvoting government member\b/i, "").trim();
  return normalized || undefined;
}

function parseDesignatingOrganizationFromSeat(seat: string): string | undefined {
  const direct = maybeString(seat);
  if (!direct) return undefined;
  const trustedPrefix = extractTrustedSeatOrganizationPrefix(direct);
  const candidates = new Set<string>();
  const addCandidate = (value: string | undefined) => {
    const candidate = maybeString(value);
    if (candidate) candidates.add(candidate);
  };
  addCandidate(extractParentheticalDesigneeOrganization(direct));
  if (trustedPrefix && hasPlainTextAfterSeatAcronym(trustedPrefix)) {
    addCandidate(extractParentheticalAgencyPrefix(trustedPrefix));
  } else if (trustedPrefix) {
    addCandidate(
      stripSeatAcronymParens(
        stripSeatSubunitDetails(stripSeatRolePrefix(trustedPrefix)),
      ),
    );
    addCandidate(stripSeatAcronymParens(stripSeatRolePrefix(trustedPrefix)));
    addCandidate(stripSeatAcronymParens(stripSeatSubunitDetails(trustedPrefix)));
    addCandidate(stripSeatAcronymParens(trustedPrefix));
    addCandidate(stripSeatSubunitDetails(stripSeatRolePrefix(trustedPrefix)));
    addCandidate(stripSeatRolePrefix(trustedPrefix));
    addCandidate(stripSeatSubunitDetails(trustedPrefix));
    addCandidate(trustedPrefix);
  }
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

function extractParentheticalAgencyPrefix(value: string): string | undefined {
  const match = value.match(/^(.+\([^)]*\))/);
  return maybeString(match?.[1]);
}

function hasPlainTextAfterSeatAcronym(value: string): boolean {
  return /\)\s+(?![-,])\S/.test(value);
}

function isLikelyQuickbaseOrganization(value: string): boolean {
  if (resolvesToExplicitKnownEntityRef(value)) return true;
  if (/\breserve corps\b/i.test(value)) return false;
  if (/\b(officer|advisor|counselor|representative)\b/i.test(value)) return false;
  return /\b(department|office|agency|administration|board|commission|council|committee|authority|university|library|district department|mayor's office)\b/i
    .test(value);
}

function isSafeQuickbaseSeededAuthorityEndpoint(
  name: string,
  appointeeDesignation: string,
): boolean {
  if (!/\bDC Agency Representative\b/i.test(appointeeDesignation)) return false;
  return quickbaseSafeSeededAuthorityEndpoints.has(normalizeQuickbasePolicyName(name));
}

function resolvesToExplicitKnownEntityRef(value: string): boolean {
  const knownRef = buildKnownEntityRef(value);
  if (knownRef === buildEntityId(value)) return false;
  const acronymStripped = stripSeatAcronymParens(value);
  return knownRef !== buildEntityId(acronymStripped);
}

function normalizeQuickbasePolicyName(name: string): string {
  return name.trim().toLowerCase();
}

function deriveQuickbaseCluster(board: string): string | undefined {
  if (/task force/i.test(board)) return "Task Force";
  if (/advisory committee/i.test(board)) return "Advisory Committee";
  if (/committee/i.test(board)) return "Committee";
  if (/commission/i.test(board)) return "Commission";
  if (/board/i.test(board)) return "Board";
  return undefined;
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
