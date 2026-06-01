import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { buildV2Release } from "../src/v2/release.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  admin311Fixture,
  adminBudgetPageFixture,
  adminProcurementPageFixture,
  arcgisLayerDetailFixture,
  arcgisServiceLayersFixture,
  councilCommitteeHealthDetailFixture,
  councilCommitteeWholeDetailFixture,
  councilCommitteesFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  legalEntrypointsFixture,
  limsFixture,
  openDcBoardFixture,
  openDcCommissionFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("fresh v2 workbench initializes and init is idempotent", async () => {
  const dir = await Deno.makeTempDir();
  await ensureDir(join(dir, "data"));
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  const first = workbench.init();
  const second = workbench.init();
  workbench.close();
  assertEquals(first.schemaVersion, 2);
  assertEquals(second.schemaVersion, 2);
  assertEquals(second.migrations.length, 2);
});

Deno.test("imports representative connector results and source inspection stays queryable after failures", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const responses = new Map<string, string>([
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json",
      JSON.stringify(dcgisMetadataFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json",
      JSON.stringify(dcgisRowsFixture),
    ],
    ["https://www.open-dc.gov/public-bodies", openDcIndexFixture],
    ["https://www.open-dc.gov/public-bodies/board-accountancy", openDcBoardFixture],
    [
      "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force",
      openDcTaskForceFixture,
    ],
    ["https://dccouncil.gov/committees/", councilCommitteesFixture],
    ["https://dccouncil.gov/committees/committee-of-the-whole/", councilCommitteeWholeDetailFixture],
    ["https://dccouncil.gov/committees/committee-on-health/", councilCommitteeHealthDetailFixture],
    ["https://lims.dccouncil.gov/api/Search/GetWhatsNew", limsFixture],
    ["https://octo.quickbase.com/db/bjngwsngm?a=td", quickbaseFixture],
    ["https://dc.gov/page/laws-regulations-and-courts", legalEntrypointsFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Service_WebMercator/MapServer/33?f=json",
      admin311Fixture,
    ],
    ["https://cfo.dc.gov/budget", adminBudgetPageFixture],
    ["https://ocp.dc.gov/page/doing-business-dc-government", adminProcurementPageFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/46?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate of Occupancy")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/45?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Home Occupancy Permit")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/5?f=json",
      JSON.stringify(arcgisLayerDetailFixture("ABCA Liquor License Locations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/7?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Bias Crime")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/24?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Vehicular Crash Data")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/29?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Shot Spotter Gun Shots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate Of Occupancy Points")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/39?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Tax Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/33?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Parcel Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/35?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Reservations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/8?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Mail Ballot Drop Boxes")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/9?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Election Day Vote Center")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Early Vote Center")),
    ],
  ]);
  const fetcher = async (url: string) => {
    const body = responses.get(url);
    if (!body) throw new Error(`Unexpected fixture url ${url}`);
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  for (
    const sourceId of [
      "dcgis.agencies",
      "open_dc.public_bodies",
      "council.committees",
      "council.lims",
      "mota.quickbase",
      "legal.entrypoints",
      "admin.service_requests_311",
      "admin.budget_sources",
      "admin.permits_licenses",
      "admin.crime_public_safety",
      "admin.procurement_sources",
      "admin.property_land",
      "admin.elections",
    ]
  ) {
    const connector = getConnector(sourceId);
    const result = await connector.run(createConnectorContext({ fetcher, limit: 2 }));
    await workbench.importConnectorResult(result, dataDir);
  }
  const dcgis = workbench.sourceSummary("dcgis.agencies");
  const quickbase = workbench.sourceSummary("mota.quickbase");
  const permitSummary = workbench.sourceSummary("admin.permits_licenses");
  const categories = new Set(workbench.datasets().map((dataset) => dataset.category));
  const hasRegisterRef = workbench.legalRefs().some((ref) => ref.ref_type === "dc_register");
  workbench.close();
  assertEquals(dcgis.fieldCount, 7);
  assertEquals(dcgis.entityCandidateCount, 2);
  assertEquals(dcgis.relationshipCandidateCount, 2);
  assertEquals(quickbase.latestStatus, "failed");
  assertStringIncludes(quickbase.latestArtifactPath ?? "", "mota.quickbase");
  assertEquals(hasRegisterRef, true);
  assertEquals(permitSummary.fieldCount > 0, true);
  assertEquals(categories.has("procurement"), true);
  assertEquals(categories.has("budget"), true);
  assertEquals(categories.has("crime_incidents"), true);
});

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
  workbench.close();
  assert(detailItem.artifactPath !== indexItem.artifactPath);
  assertEquals(evidence.artifactPath, detailItem.artifactPath);
});

Deno.test("Open DC second detail-page shape yields administered and legal-authority relationship candidates plus document links", async () => {
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
  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 1 }));
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.items?.some((item) =>
      item.itemType === "document_link" && String(item.body.href).includes("commission-charter.pdf")
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Office of the City Administrator"
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "authorized_by" &&
      candidate.rawValue === "Mayor's Order 2019-010"
    ),
  );
});

Deno.test("multi-artifact connector imports keep schema and row evidence on the correct artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(dcgisRowsFixture);
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
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const schemaArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_fields
     join source_artifacts on source_artifacts.artifact_id = source_fields.artifact_id
     where source_fields.endpoint_id = ? and source_fields.field_name = ?`,
  ).get("dcgis.agencies.main", "AGENCY_NAME") as { artifactPath: string };
  const rowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "1001") as { artifactPath: string };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.dcgis.agencies.1001") as { artifactPath: string };
  workbench.close();
  assert(schemaArtifact.artifactPath !== rowArtifact.artifactPath);
  assertEquals(evidence.artifactPath, rowArtifact.artifactPath);
});

Deno.test("relationship acceptance creates a reviewable placeholder entity", async () => {
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
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
      payload: {},
    },
    resolutionsDir,
  );
  const placeholderView = workbench.entityView("dc.council");
  const reviewItems = workbench.listReviewItems("entities");
  workbench.close();
  assertEquals(placeholderView.reviewStatus, "placeholder");
  assertStringIncludes(placeholderView.placeholderReason ?? "", "relationship candidate");
  assert(
    reviewItems.some((item) =>
      item.itemType === "placeholder_entity" && item.subjectId === "dc.council"
    ),
  );
});

Deno.test("Council committee oversight extraction only emits explicit source-backed overseen_by candidates", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  const oversightCandidates = parsed.relationshipCandidates?.filter((candidate) =>
    candidate.relationshipType === "overseen_by"
  ) ?? [];
  assertEquals(oversightCandidates.length, 2);
  assert(
    oversightCandidates.every((candidate) =>
      candidate.sourceItemKey.includes(":oversight") && candidate.needsReview === true
    ),
  );
});

Deno.test("review ordering surfaces source failures, placeholders, blocked relationships, and high-confidence entities in a stable order", async () => {
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
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        case "https://octo.quickbase.com/db/bjngwsngm?a=td":
          return quickbaseFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const relationshipCandidate = workbench.listReviewItems({ mode: "relationships" }).find((item) =>
    item.subjectId.endsWith("_part_of")
  );
  assert(relationshipCandidate);
  const matchingEntityCandidateId = relationshipCandidate.subjectId
    .replace(/^relationship\./, "candidate.")
    .replace(/_part_of$/, "");
  const matchingEntityCandidate = workbench.listReviewItems({ type: "entity_candidate" }).find(
    (item) => item.subjectId === matchingEntityCandidateId,
  );
  assert(matchingEntityCandidate);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: matchingEntityCandidate.subjectId,
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: relationshipCandidate.subjectId,
      payload: {},
    },
    resolutionsDir,
  );
  const items = workbench.listReviewItems();
  workbench.close();
  assertEquals(items[0].itemType, "source_status");
  assertEquals(items[0].subjectId, "mota.quickbase");
  assertEquals(items[1].itemType, "placeholder_entity");
  assertEquals(items[1].subjectId, "dc.council");
  assert(items.slice(2).some((item) => item.itemType === "relationship_candidate"));
  assert(items.slice(2).some((item) => item.itemType === "entity_candidate"));
});

Deno.test("review list filters by mode, status, type, and subject prefix", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();
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
      "review",
      "list",
      "--mode",
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.council.committees",
      "--db",
      dbPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0);
  const text = new TextDecoder().decode(output.stdout);
  assertStringIncludes(text, "Review items:");
  assertStringIncludes(text, "entity_candidate");
  assert(!text.includes("source_status"));
});

Deno.test("deferred review items stay visible but sort behind open items", async () => {
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
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const deferredItem = workbench.listReviewItems({ type: "entity_candidate" })[0];
  assert(deferredItem);
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: deferredItem.reviewItemId,
      payload: {},
    },
    resolutionsDir,
  );
  const items = workbench.listReviewItems({ type: "entity_candidate" });
  workbench.close();
  assertEquals(items.at(-1)?.status, "deferred");
  assert(items.slice(0, -1).every((item) => item.status === "open"));
});

Deno.test("batch accept-safe writes JSONL resolution events and leaves risky review items alone", async () => {
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
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();
  const batchOutput = await new Deno.Command(Deno.execPath(), {
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
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted ");
  let resolutionFile = "";
  for await (const entry of Deno.readDir(resolutionsDir)) {
    if (!entry.isDirectory) continue;
    for await (const child of Deno.readDir(join(resolutionsDir, entry.name))) {
      if (child.isFile && child.name.endsWith(".jsonl")) {
        resolutionFile = join(resolutionsDir, entry.name, child.name);
      }
    }
  }
  assert(resolutionFile);
  const lines = (await Deno.readTextFile(resolutionFile)).trim().split("\n").filter(Boolean);
  assert(lines.length > 0);
  assert(lines.every((line) => JSON.parse(line).event_type === "accept_entity_candidate"));
  const reopened = new Workbench(dbPath);
  reopened.init();
  assert(reopened.listReviewItems({ mode: "relationships" }).length > 0);
  reopened.close();
});

Deno.test("resolution replay accepts entities, merges duplicates, accepts one directed relationship, and surfaces inverse display", async () => {
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
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
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
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.adult_career_pathways_task_force",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {
        entityId: "dc.council",
        candidateIds: ["candidate.council.committees.committee_of_the_whole"],
      },
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
      payload: {},
    },
    resolutionsDir,
  );
  const entity = workbench.entityView("dc.council");
  workbench.close();
  assert(entity.incoming.some((row) => row.sourceEntityId === "dc.committee_of_the_whole"));
  assertEquals(entity.incoming.length, 1);
  assertEquals(entity.incoming[0].relationshipType, "has_part");
});

Deno.test("release builder creates focused v2 package with stable files and no raw source rows in entity csv", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.board_accountancy', 'Board of Accountancy', 'board', 'https://www.open-dc.gov/public-bodies/board-accountancy', 'accepted', '[\"candidate.open_dc.public_bodies.board_accountancy\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.board_accountancy:part_of:dc.council', 'dc.board_accountancy', 'part_of', 'dc.council', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.upsertSource(
    "open_dc.public_bodies",
    "Open DC Public Bodies",
    "public_body_pages",
    "official_page_html",
    "https://www.open-dc.gov/public-bodies",
  );
  workbench.db.prepare(
    "insert into datasets(dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "dataset.council.lims.whats_new",
    "item.1",
    "Council LIMS What's New feed",
    "legislative",
    "Council of the District of Columbia",
    "official_json_api",
    "sample",
    "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
    "pending",
  ]);
  workbench.db.prepare(
    "insert into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "legal.open_dc.public_bodies.board_accountancy_authority",
    "item.2",
    "dc_code",
    "D.C. Official Code § 47-2853.06(b)(1)",
    "D.C. Code 47-2853.06(b)(1)",
    "https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06#(b)(1)",
    "pending",
  ]);
  const outDir = join(dir, "release");
  const result = await buildV2Release(workbench, outDir);
  const entityCsv = await Deno.readTextFile(join(outDir, "entities.csv"));
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();
  assertEquals(
    result.fileNames.sort(),
    [
      "README.md",
      "dcgov.sqlite",
      "datasets.csv",
      "datasets.json",
      "entities.csv",
      "entities.json",
      "legal_refs.csv",
      "legal_refs.json",
      "manifest.json",
      "relationships.csv",
      "relationships.json",
      "sources.csv",
      "sources.json",
    ].sort(),
  );
  assertStringIncludes(
    entityCsv.split("\n")[0],
    "id,name,kind,branch,cluster,official_url,review_status",
  );
  assert(!entityCsv.includes("source_item_id"));
  assertStringIncludes(readme, "DCGov v2 Release");
});

Deno.test("scripted review CLI accepts a candidate and entity show renders evidence and backlinks", async () => {
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
  const reviewRun = new Deno.Command(Deno.execPath(), {
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
      "review",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("a\na\nq\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  assertStringIncludes(new TextDecoder().decode(reviewOutput.stdout), "Saved resolution.");
  const searchOutput = await new Deno.Command(Deno.execPath(), {
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
      "entity",
      "search",
      "accountancy",
      "--db",
      dbPath,
    ],
  }).output();
  assertStringIncludes(new TextDecoder().decode(searchOutput.stdout), "dc.board_of_accountancy");
  const showOutput = await new Deno.Command(Deno.execPath(), {
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
      "entity",
      "show",
      "dc.board_of_accountancy",
      "--db",
      dbPath,
    ],
  }).output();
  const showText = new TextDecoder().decode(showOutput.stdout);
  assertStringIncludes(showText, "Board of Accountancy");
  assertStringIncludes(showText, "evidence:");
  assertStringIncludes(showText, "@");
  assertStringIncludes(showText, "legal_refs:");
});
