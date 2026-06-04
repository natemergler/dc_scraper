import {
  buildEntityId,
  buildReviewItemId,
  type ConnectorResult,
  parseLegalReference,
  type RelationshipType,
} from "../../src/v2/domain.ts";

export function syntheticEntitySourceResult(
  candidateId: string,
  observedName: string,
): ConnectorResult {
  return {
    source: {
      sourceId: "test.signature.entities",
      title: "Test Signature Entities",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/signature-entities",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.signature.entities.main",
        sourceId: "test.signature.entities",
        title: "Signature entity rows",
        kind: "fixture",
        url: "https://example.com/signature-entities",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/signature-entities",
        contentText: JSON.stringify({ candidateId, observedName }),
      }],
      parsed: {
        items: [{
          itemKey: "example-row",
          itemType: "fixture_row",
          title: "Example row",
          body: { observedName },
        }],
        entityCandidates: [{
          candidateId,
          sourceItemKey: "example-row",
          proposedEntityId: buildEntityId("Example Body"),
          name: "Example Body",
          kind: "board",
          evidence: [{
            fieldPath: "name",
            observedValue: observedName,
          }],
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId(candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: "Example Body",
            kind: "board",
          },
        }],
      },
    }],
  };
}

export function syntheticCustomEntitySourceResult(input: {
  sourceId: string;
  candidateId: string;
  sourceItemKey: string;
  proposedEntityId: string;
  name: string;
  kind: string;
  observedName: string;
  branch?: string;
  cluster?: string;
  officialUrl?: string;
  confidence?: number;
}): ConnectorResult {
  return {
    source: {
      sourceId: input.sourceId,
      title: "Test Custom Entities",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: `https://example.com/${input.sourceId}`,
    },
    endpointResults: [{
      endpoint: {
        endpointId: `${input.sourceId}.main`,
        sourceId: input.sourceId,
        title: "Custom entity rows",
        kind: "fixture",
        url: `https://example.com/${input.sourceId}`,
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: `https://example.com/${input.sourceId}`,
        contentText: JSON.stringify({
          candidateId: input.candidateId,
          observedName: input.observedName,
        }),
      }],
      parsed: {
        items: [{
          itemKey: input.sourceItemKey,
          itemType: "fixture_row",
          title: "Custom entity row",
          body: { observedName: input.observedName },
        }],
        entityCandidates: [{
          candidateId: input.candidateId,
          sourceItemKey: input.sourceItemKey,
          proposedEntityId: input.proposedEntityId,
          name: input.name,
          kind: input.kind,
          branch: input.branch,
          cluster: input.cluster,
          officialUrl: input.officialUrl,
          confidence: input.confidence,
          evidence: [{
            fieldPath: "name",
            observedValue: input.observedName,
          }],
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId(input.candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: input.candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: input.name,
            kind: input.kind,
          },
        }],
      },
    }],
  };
}

export function syntheticLegalRefSourceResult(
  legalRefId: string,
  citationText: string,
  url: string,
): ConnectorResult {
  const parsed = parseLegalReference(citationText, url);
  return {
    source: {
      sourceId: "test.signature.legal_refs",
      title: "Test Signature Legal Refs",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/signature-legal-refs",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.signature.legal_refs.main",
        sourceId: "test.signature.legal_refs",
        title: "Signature legal ref rows",
        kind: "fixture",
        url: "https://example.com/signature-legal-refs",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/signature-legal-refs",
        contentText: JSON.stringify({ legalRefId, citationText, url }),
      }],
      parsed: {
        items: [{
          itemKey: "example-legal-row",
          itemType: "fixture_row",
          title: "Example legal row",
          body: { citationText, url },
        }],
        legalRefs: [{
          legalRefId,
          sourceItemKey: "example-legal-row",
          refType: parsed.refType,
          citationText,
          normalizedCitation: parsed.normalizedCitation,
          url,
          needsReview: true,
          evidence: [{
            fieldPath: "citation",
            observedValue: citationText,
          }, {
            fieldPath: "url",
            observedValue: url,
          }],
        }],
      },
    }],
  };
}

export function syntheticRelationshipSourceResult(
  relationshipCandidateId: string,
  rawValue: string,
): ConnectorResult {
  return syntheticCustomRelationshipSourceResult({
    sourceId: "test.signature.relationships",
    relationshipCandidateId,
    sourceItemKey: "example-relationship-row",
    fromEntityRef: "dc.source_board",
    toEntityRef: "dc.target_agency",
    relationshipType: "governed_by",
    rawValue,
  });
}

export function syntheticCustomRelationshipSourceResult(input: {
  sourceId: string;
  relationshipCandidateId: string;
  sourceItemKey: string;
  fromEntityRef: string;
  toEntityRef: string;
  relationshipType: RelationshipType;
  rawValue: string;
  needsReview?: boolean;
}): ConnectorResult {
  return {
    source: {
      sourceId: input.sourceId,
      title: "Test Signature Relationships",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: `https://example.com/${input.sourceId}`,
    },
    endpointResults: [{
      endpoint: {
        endpointId: `${input.sourceId}.main`,
        sourceId: input.sourceId,
        title: "Signature relationship rows",
        kind: "fixture",
        url: `https://example.com/${input.sourceId}`,
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: `https://example.com/${input.sourceId}`,
        contentText: JSON.stringify({
          relationshipCandidateId: input.relationshipCandidateId,
          rawValue: input.rawValue,
        }),
      }],
      parsed: {
        items: [{
          itemKey: input.sourceItemKey,
          itemType: "fixture_row",
          title: "Example relationship row",
          body: { rawValue: input.rawValue },
        }],
        relationshipCandidates: [{
          relationshipCandidateId: input.relationshipCandidateId,
          sourceItemKey: input.sourceItemKey,
          fromEntityRef: input.fromEntityRef,
          toEntityRef: input.toEntityRef,
          relationshipType: input.relationshipType,
          rawValue: input.rawValue,
          needsReview: input.needsReview ?? true,
          evidence: [{
            fieldPath: "governingAgency",
            observedValue: input.rawValue,
          }],
        }],
      },
    }],
  };
}
