import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildKnownEntityRef } from "../src/v2/connectors/shared.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  openDcBoardFixture,
  openDcCommissionFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
} from "./helpers/v2_fixtures.ts";
import { syntheticCustomEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("Open DC detail evidence points to the detail artifact rather than the index artifact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  const detailItem = workbench.db.prepare(
    `select source_items.source_item_id as sourceItemId,
            source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("open_dc.public_bodies.detail", "board-accountancy") as {
    sourceItemId: string;
    artifactPath: string;
  };
  const indexItem = workbench.db.prepare(
    `select source_items.source_item_id as sourceItemId,
            source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("open_dc.public_bodies.index", "board-accountancy") as {
    sourceItemId: string;
    artifactPath: string;
  };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.open_dc.public_bodies.board_accountancy") as { artifactPath: string };
  const taskForceLegalRef = workbench.db.prepare(
    "select url from legal_refs where legal_ref_id = ?",
  ).get("legal.open_dc.public_bodies.adult_career_pathways_task_force_authority") as {
    url: string | null;
  };
  const endpointAliases = new Map(
    workbench.db.prepare(
      "select raw_value as rawValue, to_entity_ref as toEntityRef from relationship_candidates where raw_value in ('DLCP/OPL', 'DOES')",
    ).all().map((row) => {
      const alias = row as { rawValue: string; toEntityRef: string };
      return [alias.rawValue, alias.toEntityRef];
    }),
  );
  workbench.close();
  assert(detailItem.artifactPath !== indexItem.artifactPath);
  assertEquals(evidence.artifactPath, detailItem.artifactPath);
  assertEquals(taskForceLegalRef.url, null);
  assertEquals(
    endpointAliases.get("DLCP/OPL"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(endpointAliases.get("DOES"), "dc.department_of_employment_services");
});

Deno.test("Open DC recess and duplicate detail titles stay as source evidence only", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const recessTitle = "April Board of Accountancy - (RECESS)";
  const duplicateTitle = "April Board of Accountancy - (DUPLICATE)";
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/april-board-of-accountancy-recess">${recessTitle}</a>
            <a href="/public-bodies/april-board-of-accountancy-duplicate">${duplicateTitle}</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/april-board-of-accountancy-recess":
          return `<html><body><h1 class="page-title">${recessTitle}</h1></body></html>`;
        case "https://www.open-dc.gov/public-bodies/april-board-of-accountancy-duplicate":
          return `<html><body><h1 class="page-title">${duplicateTitle}</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(detail.items);
  assertEquals(detail.items.map((item) => item.title), [recessTitle, duplicateTitle]);
  assertEquals(detail.entityCandidates, []);
  assertEquals(detail.relationshipCandidates, []);
  assertEquals(detail.legalRefs, []);

  await workbench.importConnectorResult(result, dataDir);
  const sourceItemCount = workbench.db.prepare(
    "select count(*) as count from source_items where item_key like 'april-board-of-accountancy-%'",
  ).get() as { count: number };
  const candidateCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.open_dc.public_bodies.april_board_of_accountancy%'",
  ).get() as { count: number };
  workbench.close();

  assertEquals(sourceItemCount.count, 4);
  assertEquals(candidateCount.count, 0);
});

Deno.test("Open DC refetch removes stale suspicious agency source review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const connector = getConnector("open_dc.public_bodies");
  const fetcherForAgencyLabel = (agencyLabel: string) => async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/common-lottery-board">Common Lottery Board</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/common-lottery-board":
          return `<html><body>
            <h1 class="page-title">Common Lottery Board</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">${agencyLabel}</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await connector.run(createConnectorContext({
      fetcher: fetcherForAgencyLabel("Department of Eduaction"),
    })),
    dataDir,
  );

  const firstReviewCount = workbench.db.prepare(
    `select count(*) as count
     from review_items
     where item_type = 'source_status'
       and json_extract(details_json, '$.rawValue') = 'Department of Eduaction'`,
  ).get() as { count: number };
  assertEquals(firstReviewCount.count, 1);

  await workbench.importConnectorResult(
    await connector.run(createConnectorContext({
      fetcher: fetcherForAgencyLabel("Independent Agency"),
    })),
    dataDir,
  );

  const staleReviewCount = workbench.db.prepare(
    `select count(*) as count
     from review_items
     where item_type = 'source_status'
       and json_extract(details_json, '$.rawValue') = 'Department of Eduaction'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(staleReviewCount.count, 0);
});

Deno.test("Open DC public bodies can be safely accepted before relationship review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  workbench.close();

  const batchOutput = await runDcCli([
    "review",
    "batch",
    "accept-safe",
    "--mode",
    "entities",
    "--subject-prefix",
    "candidate.open_dc.public_bodies",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
  ]);
  assertEquals(batchOutput.code, 0);
  const batchText = batchOutput.stdout;
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationshipItems = reopened.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.open_dc.public_bodies",
  });
  const acceptedRelationships = reopened.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       'dc.board_of_accountancy:governed_by:dc.department_of_licensing_and_consumer_protection',
       'dc.adult_career_pathways_task_force:governed_by:dc.department_of_employment_services'
     )
     order by relationship_id`,
  ).all() as Array<{ relationshipId: string }>;
  const acceptedAuthorityCandidates = reopened.db.prepare(
    `select review_status as reviewStatus
     from relationship_candidates
     where relationship_candidate_id in (
       'relationship.open_dc.public_bodies.board_accountancy_authorized_by',
       'relationship.open_dc.public_bodies.adult_career_pathways_task_force_authorized_by'
     )
     order by relationship_candidate_id`,
  ).all() as Array<{ reviewStatus: string }>;
  const blockedRelationship = reopened.db.prepare(
    `select reason, details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.open_dc.public_bodies.board_accountancy_governing_agency'`,
  ).get() as { reason: string; detailsJson: string } | undefined;
  reopened.close();

  assertEquals(relationshipItems.length, 2);
  assert(relationshipItems.every((item) => item.conflictKind === "unresolved_symbol"));
  assertEquals(acceptedRelationships.length, 0);
  assertEquals(acceptedAuthorityCandidates.length, 0);
  assert(blockedRelationship);
  assertEquals(blockedRelationship.reason, "unresolved_endpoints");
  assertStringIncludes(
    blockedRelationship.detailsJson,
    "dc.department_of_licensing_and_consumer_protection",
  );
});

Deno.test("Open DC legal authority stays attached to the entity without a non-exported relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/commission-on-example-services">Commission on Example Services</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-on-example-services":
          return openDcCommissionFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 1 })),
    dataDir,
  );
  const relationshipLegalAttachmentRows = workbench.db.prepare(
    "select relationship_id as relationshipId, legal_ref_id as legalRefId from relationship_legal_refs order by relationship_id",
  ).all().map((row) => row as { relationshipId: string; legalRefId: string });
  const entityLegalAttachmentRows = workbench.db.prepare(
    "select entity_id as entityId, legal_ref_id as legalRefId from entity_legal_refs order by entity_id",
  ).all().map((row) => row as { entityId: string; legalRefId: string });
  const authorityRelationshipCount = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where relationship_type = 'authorized_by'",
  ).get() as { count: number };
  workbench.close();
  assertEquals(relationshipLegalAttachmentRows, []);
  assertEquals(entityLegalAttachmentRows, [{
    entityId: "dc.commission_on_example_services",
    legalRefId: "legal.open_dc.public_bodies.commission_on_example_services_authority",
  }]);
  assertEquals(authorityRelationshipCount.count, 0);
});

Deno.test("Open DC known alias refinements fill official URLs on existing full-label entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId:
        "candidate.mota.quickbase.washington_d_c_convention_and_tourism_corporation_destination_dc",
      sourceItemKey: "quickbase-washington-dc-convention-and-tourism-corporation-destination-dc",
      proposedEntityId: "dc.washington_d_c_convention_and_tourism_corporation",
      name: "Washington D.C. Convention and Tourism Corporation (Destination DC)",
      kind: "public_body",
      observedName: "Washington D.C. Convention and Tourism Corporation (Destination DC)",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc">Washington D.C. Convention and Tourism Corporation (Destination DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc":
          return `<html><body><h1 class="page-title">Washington D.C. Convention and Tourism Corporation (Destination DC)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);

  const canonical = workbench.db.prepare(
    `select name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.washington_d_c_convention_and_tourism_corporation'`,
  ).get() as {
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.destination_dc'`,
  ).get() as { count: number };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.open_dc.public_bodies.washington_dc_convention_and_tourism_corporation_destination_dc",
  });
  workbench.close();

  assertEquals(
    canonical.name,
    "Washington D.C. Convention and Tourism Corporation (Destination DC)",
  );
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.mota.quickbase.washington_d_c_convention_and_tourism_corporation_destination_dc",
    "candidate.open_dc.public_bodies.washington_dc_convention_and_tourism_corporation_destination_dc",
  ]);
  assertEquals(splitCanonical.count, 0);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC direct public-body pages beat generic service pages for canonical official URLs", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      candidateId: "candidate.dcgis.boards_commissions_councils.32",
      sourceItemKey: "32",
      proposedEntityId: "dc.board_of_barber_and_cosmetology",
      name: "Board of Barber and Cosmetology",
      kind: "board",
      officialUrl: "https://dchealth.dc.gov/service/barber-cosmetology-and-personal-grooming",
      observedName: "Board of Barber and Cosmetology",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-barber-and-cosmetology">Board of Barber and Cosmetology</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-barber-and-cosmetology":
          return `<html><body><h1 class="page-title">Board of Barber and Cosmetology</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.board_of_barber_and_cosmetology'`,
  ).get() as {
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  workbench.close();

  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/board-barber-and-cosmetology",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.dcgis.boards_commissions_councils.32",
    "candidate.open_dc.public_bodies.board_barber_and_cosmetology",
  ]);
});

Deno.test("Open DC supplemental public body index does not create a bogus Public Bodies entity shell", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      candidateId: "candidate.dcgis.boards_commissions_councils.49",
      sourceItemKey: "49",
      proposedEntityId: "dc.board_of_pharmacy",
      name: "Board of Pharmacy",
      kind: "board",
      officialUrl: "https://dchealth.dc.gov/service/pharmacy-licensure",
      observedName: "Board of Pharmacy",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <div>Boards &amp; Commissions Tools</div>
            <div>Office of Open Government</div>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies-general-0":
          return `<html><body>
            <a href="/public-bodies/board-pharmacy">Board of Pharmacy</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return `<html><body><h1 class="page-title">Board of Accountancy</h1></body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-pharmacy":
          return `<html><body><h1 class="page-title">Public Bodies</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.board_of_pharmacy'`,
  ).get() as {
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const bogusCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.public_bodies'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(
    canonical.officialUrl,
    "https://dchealth.dc.gov/service/pharmacy-licensure",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.dcgis.boards_commissions_councils.49",
  ]);
  assertEquals(bogusCanonical.count, 0);
});

Deno.test("Open DC general counsel governing agency alias reuses the accepted legal counsel office", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.mayor_s_office_of_legal_counsel",
      sourceItemKey: "dcgis-mayors-office-of-legal-counsel",
      proposedEntityId: "dc.mayor_s_office_of_legal_counsel",
      name: "Mayor's Office of Legal Counsel",
      kind: "office",
      officialUrl: "https://molc.dc.gov/",
      observedName: "Mayor's Office of Legal Counsel",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/advisory-committee-office-administrative-hearings-oah">Advisory Committee to the Office of Administrative Hearings (OAH)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/advisory-committee-office-administrative-hearings-oah":
          return `<html><body>
            <h1 class="page-title">Advisory Committee to the Office of Administrative Hearings (OAH)</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Mayor's Office of General Counsel</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.advisory_committee_to_the_office_of_administrative_hearings:governed_by:dc.mayor_s_office_of_legal_counsel'`,
  ).get() as { relationshipId: string } | undefined;
  const pendingCandidate = workbench.db.prepare(
    `select review_status as reviewStatus, to_entity_ref as toEntityRef
     from relationship_candidates
     where relationship_candidate_id = 'relationship.open_dc.public_bodies.advisory_committee_office_administrative_hearings_oah_governing_agency'`,
  ).get() as { reviewStatus: string; toEntityRef: string } | undefined;
  const endpointCandidateCount = workbench.db.prepare(
    `select count(*) as count
     from entity_candidates
     where proposed_entity_id = 'dc.mayor_s_office_of_general_counsel'`,
  ).get() as { count: number };
  const openReview = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix:
      "relationship.open_dc.public_bodies.advisory_committee_office_administrative_hearings_oah_governing_agency",
  });
  workbench.close();

  assertEquals(
    relationship?.relationshipId,
    "dc.advisory_committee_to_the_office_of_administrative_hearings:governed_by:dc.mayor_s_office_of_legal_counsel",
  );
  assertEquals(pendingCandidate, {
    reviewStatus: "accepted",
    toEntityRef: "dc.mayor_s_office_of_legal_counsel",
  });
  assertEquals(endpointCandidateCount.count, 0);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC veterans affairs governing agency alias reuses the accepted mayor's office entity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.mova",
      sourceItemKey: "dcgis-mova",
      proposedEntityId: "dc.mayor_s_office_of_veterans_affairs",
      name: "Mayor's Office of Veterans Affairs",
      kind: "office",
      officialUrl: "https://ova.dc.gov/",
      observedName: "Mayor's Office of Veterans Affairs",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/advisory-board-veterans-affairs-district-columbia">Advisory Board on Veterans Affairs for the District of Columbia</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/advisory-board-veterans-affairs-district-columbia":
          return `<html><body>
            <h1 class="page-title">Advisory Board on Veterans Affairs for the District of Columbia</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Mayor's Office of Veterans Affairs (MOVA)</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.advisory_board_on_veterans_affairs_for_the_district_of_columbia:governed_by:dc.mayor_s_office_of_veterans_affairs'`,
  ).get() as { relationshipId: string } | undefined;
  const pendingCandidate = workbench.db.prepare(
    `select review_status as reviewStatus, to_entity_ref as toEntityRef
     from relationship_candidates
     where relationship_candidate_id = 'relationship.open_dc.public_bodies.advisory_board_veterans_affairs_district_columbia_governing_agency'`,
  ).get() as { reviewStatus: string; toEntityRef: string } | undefined;
  const endpointCandidateCount = workbench.db.prepare(
    `select count(*) as count
     from entity_candidates
     where proposed_entity_id = 'dc.office_of_veterans_affairs'`,
  ).get() as { count: number };
  const openReview = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix:
      "relationship.open_dc.public_bodies.advisory_board_veterans_affairs_district_columbia_governing_agency",
  });
  workbench.close();

  assertEquals(
    relationship?.relationshipId,
    "dc.advisory_board_on_veterans_affairs_for_the_district_of_columbia:governed_by:dc.mayor_s_office_of_veterans_affairs",
  );
  assertEquals(pendingCandidate, {
    reviewStatus: "accepted",
    toEntityRef: "dc.mayor_s_office_of_veterans_affairs",
  });
  assertEquals(endpointCandidateCount.count, 0);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC stale SRC governing agency label does not override the DDS-backed governing office", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.dds",
      sourceItemKey: "dcgis-dds",
      proposedEntityId: "dc.department_on_disability_services",
      name: "Department on Disability Services",
      kind: "agency",
      officialUrl: "https://dds.dc.gov/",
      observedName: "Department on Disability Services",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/state-rehabilitation-council-src">State Rehabilitation Council (SRC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/state-rehabilitation-council-src":
          return `<html><body>
            <h1 class="page-title">State Rehabilitation Council (SRC)</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Department of Human Services (DHS)</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const staleRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.state_rehabilitation_council_src:governed_by:dc.department_of_human_services'`,
  ).get() as { relationshipId: string } | undefined;
  const staleCandidate = workbench.db.prepare(
    `select relationship_candidate_id as relationshipCandidateId
     from relationship_candidates
     where relationship_candidate_id = 'relationship.open_dc.public_bodies.state_rehabilitation_council_src_governing_agency'`,
  ).get() as { relationshipCandidateId: string } | undefined;
  const openReview = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix:
      "relationship.open_dc.public_bodies.state_rehabilitation_council_src_governing_agency",
  });
  workbench.close();

  assertEquals(staleRelationship, undefined);
  assertEquals(staleCandidate, undefined);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC stale OST Commission umbrella governance label does not override the OST Office", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.ost_office",
      sourceItemKey: "dcgis-ost-office",
      proposedEntityId: "dc.office_of_out_of_school_time_grants_and_youth_outcomes",
      name: "Office of Out of School Time Grants and Youth Outcomes",
      kind: "agency",
      observedName: "Office of Out of School Time Grants and Youth Outcomes",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/commission-out-school-time-grants-and-youth-outcomes">Commission on Out of School Time Grants and Youth Outcomes</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-out-school-time-grants-and-youth-outcomes":
          return `<html><body>
            <h1 class="page-title">Commission on Out of School Time Grants and Youth Outcomes</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Executive Office of the Mayor</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const staleRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.executive_office_of_the_mayor'`,
  ).get() as { relationshipId: string } | undefined;
  const staleCandidate = workbench.db.prepare(
    `select relationship_candidate_id as relationshipCandidateId
     from relationship_candidates
     where relationship_candidate_id = 'relationship.open_dc.public_bodies.commission_out_school_time_grants_and_youth_outcomes_governing_agency'`,
  ).get() as { relationshipCandidateId: string } | undefined;
  const openReview = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix:
      "relationship.open_dc.public_bodies.commission_out_school_time_grants_and_youth_outcomes_governing_agency",
  });
  workbench.close();

  assertEquals(staleRelationship, undefined);
  assertEquals(staleCandidate, undefined);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC stale POST governing agency label does not override MPD-backed governance evidence", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.mpd",
      sourceItemKey: "dcgis-mpd",
      proposedEntityId: "dc.metropolitan_police_department",
      name: "Metropolitan Police Department",
      kind: "agency",
      officialUrl: "https://mpdc.dc.gov/",
      observedName: "Metropolitan Police Department",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/police-officers-standards-and-training-board-post">Police Officers Standards and Training Board (POST)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/police-officers-standards-and-training-board-post":
          return `<html><body>
            <h1 class="page-title">Police Officers Standards and Training Board (POST)</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Office of Police Complaints</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const staleRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.police_officers_standards_and_training_board:governed_by:dc.office_of_police_complaints'`,
  ).get() as { relationshipId: string } | undefined;
  const staleCandidate = workbench.db.prepare(
    `select relationship_candidate_id as relationshipCandidateId
     from relationship_candidates
     where relationship_candidate_id = 'relationship.open_dc.public_bodies.police_officers_standards_and_training_board_post_governing_agency'`,
  ).get() as { relationshipCandidateId: string } | undefined;
  const openReview = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix:
      "relationship.open_dc.public_bodies.police_officers_standards_and_training_board_post_governing_agency",
  });
  workbench.close();

  assertEquals(staleRelationship, undefined);
  assertEquals(staleCandidate, undefined);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC does not export derived agency-twin governance edges for public bodies", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.abca",
      sourceItemKey: "dcgis-abca",
      proposedEntityId: "dc.alcoholic_beverage_and_cannabis_administration",
      name: "Alcoholic Beverage and Cannabis Administration",
      kind: "agency",
      officialUrl: "https://abca.dc.gov/",
      observedName: "Alcoholic Beverage and Cannabis Administration",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/alcoholic-beverage-and-cannabis-board-abc-board">Alcoholic Beverage and Cannabis Board (ABC Board)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/alcoholic-beverage-and-cannabis-board-abc-board":
          return `<html><body>
            <h1 class="page-title">Alcoholic Beverage and Cannabis Board (ABC Board)</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Alcoholic Beverage and Cannabis Administration (ABCA)</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.alcoholic_beverage_and_cannabis_board:governed_by:dc.alcoholic_beverage_and_cannabis_administration'`,
  ).get() as { relationshipId: string } | undefined;
  const pendingCandidate = workbench.db.prepare(
    `select relationship_candidate_id as relationshipCandidateId
     from relationship_candidates
     where relationship_candidate_id = 'relationship.open_dc.public_bodies.alcoholic_beverage_and_cannabis_board_governing_agency'`,
  ).get() as { relationshipCandidateId: string } | undefined;
  const openReview = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix:
      "relationship.open_dc.public_bodies.alcoholic_beverage_and_cannabis_board_governing_agency",
  });
  workbench.close();

  assertEquals(canonicalRelationship, undefined);
  assertEquals(pendingCandidate, undefined);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC non-acronym parenthetical refinements reuse accepted-style public-body identity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "mota.quickbase",
      candidateId: "candidate.mota.quickbase.commission_for_national_and_community_service",
      sourceItemKey: "quickbase-commission-for-national-and-community-service",
      proposedEntityId: "dc.commission_for_national_and_community_service",
      name: "Commission for National and Community Service (Serve DC)",
      kind: "public_body",
      observedName: "Commission for National and Community Service (Serve DC)",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/commission-national-and-community-service-serve-dc">Commission for National and Community Service (Serve DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-national-and-community-service-serve-dc":
          return `<html><body>
            <h1 class="page-title">Commission for National and Community Service (Serve DC)</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">ServeDC</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);

  const canonical = workbench.db.prepare(
    `select name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.commission_for_national_and_community_service'`,
  ).get() as {
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.commission_for_national_and_community_service_serve_dc'`,
  ).get() as { count: number };
  const selfAliasRelationship = workbench.db.prepare(
    `select count(*) as count
     from relationship_candidates
     where raw_value = 'ServeDC'`,
  ).get() as { count: number };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.open_dc.public_bodies.commission_national_and_community_service_serve_dc",
  });
  workbench.close();

  assertEquals(canonical.name, "Commission for National and Community Service (Serve DC)");
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/commission-national-and-community-service-serve-dc",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.mota.quickbase.commission_for_national_and_community_service",
    "candidate.open_dc.public_bodies.commission_national_and_community_service_serve_dc",
  ]);
  assertEquals(splitCanonical.count, 0);
  assertEquals(selfAliasRelationship.count, 0);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC long-form citizen review panel detail reuses the accepted short-form alias identity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: "candidate.open_dc.public_bodies.citizen_review_panel_child_abuse_and_neglect",
      sourceItemKey: "open-dc-citizen-review-panel-child-abuse-and-neglect",
      proposedEntityId: buildKnownEntityRef("Citizen Review Panel for Child Abuse and Neglect"),
      name: "Citizen Review Panel for Child Abuse and Neglect",
      kind: "public_body",
      officialUrl:
        "https://www.open-dc.gov/public-bodies/citizen-review-panel-child-abuse-and-neglect",
      observedName: "Citizen Review Panel for Child Abuse and Neglect",
      confidence: 0.92,
    }),
    dataDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId: "candidate.council.committees.citizen_review_panel_on_child_abuse_and_neglect",
      sourceItemKey: "council-citizen-review-panel-oversight-endpoint",
      proposedEntityId: buildKnownEntityRef("Citizen Review Panel on Child Abuse and Neglect"),
      name: "Citizen Review Panel on Child Abuse and Neglect",
      kind: "public_body",
      observedName: "Citizen Review Panel on Child Abuse and Neglect",
      confidence: 0.95,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select entity_id as entityId,
            name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.citizen_review_panel_for_child_abuse_and_neglect'`,
  ).get() as {
    entityId: string;
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.citizen_review_panel_on_child_abuse_and_neglect'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(canonical.entityId, "dc.citizen_review_panel_for_child_abuse_and_neglect");
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/citizen-review-panel-child-abuse-and-neglect",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.open_dc.public_bodies.citizen_review_panel_child_abuse_and_neglect",
    "candidate.council.committees.citizen_review_panel_on_child_abuse_and_neglect",
  ]);
  assertEquals(splitCanonical.count, 0);
});

Deno.test("Open DC architecture board detail reuses the accepted architecture board identity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      candidateId:
        "candidate.dcgis.boards_commissions_councils.board_architecture_interior_design_and_landscape_architecture",
      sourceItemKey: "dcgis-board-architecture-interior-design-and-landscape-architecture",
      proposedEntityId: buildKnownEntityRef(
        "Board of Architecture, Interior Design, and Landscape Architecture",
      ),
      name: "Board of Architecture, Interior Design, and Landscape Architecture",
      kind: "board",
      officialUrl: "https://www.dcopla.com/design/",
      observedName: "Board of Architecture, Interior Design, and Landscape Architecture",
      confidence: 0.95,
    }),
    dataDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId:
        "candidate.open_dc.public_bodies.board_architecture_interior_design_and_landscape_architect",
      sourceItemKey: "open-dc-board-architecture-interior-design-and-landscape-architect",
      proposedEntityId: buildKnownEntityRef(
        "Board of Architecture, Interior Design and Landscape Architect",
      ),
      name: "Board of Architecture, Interior Design and Landscape Architect",
      kind: "board",
      officialUrl:
        "https://www.open-dc.gov/public-bodies/board-architecture-interior-design-and-landscape-architect",
      observedName: "Board of Architecture, Interior Design and Landscape Architect",
      confidence: 0.92,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select entity_id as entityId,
            name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.board_of_architecture_interior_design_and_landscape_architecture'`,
  ).get() as {
    entityId: string;
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.board_of_architecture_interior_design_and_landscape_architect'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(
    canonical.entityId,
    "dc.board_of_architecture_interior_design_and_landscape_architecture",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.dcgis.boards_commissions_councils.board_architecture_interior_design_and_landscape_architecture",
    "candidate.open_dc.public_bodies.board_architecture_interior_design_and_landscape_architect",
  ]);
  assertEquals(splitCanonical.count, 0);
});

async function runDcCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      ...args,
    ],
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("Open DC long-form sentencing commission detail absorbs later short-form public-body aliases", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: "candidate.open_dc.public_bodies.district_columbia_sentencing_commission",
      sourceItemKey: "open-dc-district-columbia-sentencing-commission",
      proposedEntityId: buildKnownEntityRef("District of Columbia Sentencing Commission"),
      name: "District of Columbia Sentencing Commission",
      kind: "commission",
      officialUrl: "https://www.open-dc.gov/public-bodies/district-columbia-sentencing-commission",
      observedName: "District of Columbia Sentencing Commission",
      confidence: 0.92,
    }),
    dataDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "mota.quickbase",
      candidateId: "candidate.mota.quickbase.sentencing_commission",
      sourceItemKey: "quickbase-sentencing-commission",
      proposedEntityId: buildKnownEntityRef("Sentencing Commission"),
      name: "Sentencing Commission",
      kind: "public_body",
      observedName: "Sentencing Commission",
      confidence: 0.95,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select entity_id as entityId,
            name,
            kind,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.district_of_columbia_sentencing_commission'`,
  ).get() as {
    entityId: string;
    name: string;
    kind: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.sentencing_commission'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(canonical.entityId, "dc.district_of_columbia_sentencing_commission");
  assertEquals(canonical.kind, "commission");
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/district-columbia-sentencing-commission",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.open_dc.public_bodies.district_columbia_sentencing_commission",
    "candidate.mota.quickbase.sentencing_commission",
  ]);
  assertEquals(splitCanonical.count, 0);
});
