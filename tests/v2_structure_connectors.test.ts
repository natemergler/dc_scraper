import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  begaAboutFixture,
  begaOgeFixture,
  begaOogFixture,
  dcCourtOfAppealsFixture,
  dcCourtsHomeFixture,
  dcgisMetadataFixture,
  dcSuperiorCourtFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("DC Courts connector captures the root courts structure and direct Superior Court divisions only", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.dccourts.gov/":
          return dcCourtsHomeFixture;
        case "https://www.dccourts.gov/court-of-appeals":
          return dcCourtOfAppealsFixture;
        case "https://www.dccourts.gov/superior-court":
          return dcSuperiorCourtFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("dccourts.structure").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults.flatMap((endpoint) => endpoint.parsed?.items ?? []);
  const entityCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.entityCandidates ?? []
  );
  const relationshipCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.relationshipCandidates ?? []
  );
  assertEquals(result.endpointResults.length, 3);
  assertEquals(items.length, 3);
  assertEquals(entityCandidates.length, 12);
  assertEquals(relationshipCandidates.length, 11);
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "District of Columbia Courts" && candidate.kind === "court_system"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Court of Appeals" && candidate.kind === "court"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Special Operations Division" && candidate.kind === "court_division"
    ),
  );
  assert(
    !entityCandidates.some((candidate) => candidate.name === "Crime Victims Compensation Program"),
  );
  assert(
    !entityCandidates.some((candidate) => candidate.name === "Office of the Auditor-Master"),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Court of Appeals") &&
      candidate.toEntityRef === buildEntityId("District of Columbia Courts")
    ),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Tax Division") &&
      candidate.toEntityRef === buildEntityId("Superior Court")
    ),
  );
});

Deno.test("BEGA connector captures BEGA with the OGE and OOG offices only", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://bega.dc.gov/node/61616/":
          return begaAboutFixture;
        case "https://bega.dc.gov/page/office-government-ethics":
          return begaOgeFixture;
        case "https://www.open-dc.gov/office-open-government":
          return begaOogFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("bega.structure").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults.flatMap((endpoint) => endpoint.parsed?.items ?? []);
  const entityCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.entityCandidates ?? []
  );
  const relationshipCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.relationshipCandidates ?? []
  );
  assertEquals(result.endpointResults.length, 3);
  assertEquals(items.length, 3);
  assertEquals(entityCandidates.length, 3);
  assertEquals(relationshipCandidates.length, 2);
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Board of Ethics and Government Accountability" && candidate.kind ===
        "agency"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Office of Government Ethics" && candidate.kind === "office"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Office of Open Government" && candidate.kind === "office"
    ),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Office of Government Ethics") &&
      candidate.toEntityRef === buildEntityId("Board of Ethics and Government Accountability")
    ),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Office of Open Government") &&
      candidate.toEntityRef === buildEntityId("Board of Ethics and Government Accountability")
    ),
  );
});

Deno.test("DC Courts structure entities auto-promote and structural relationships no longer wait for batch accept-safe", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const dcgisRowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 1014,
        AGENCY_NAME: "DC Court of Appeals",
        TYPE: "Agency",
        BRANCH: "Judicial",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://www.dccourts.gov/court-of-appeals",
        LEGISLATION: "",
      },
    }, {
      attributes: {
        AGENCY_ID: 1026,
        AGENCY_NAME: "DC Superior Court",
        TYPE: "Agency",
        BRANCH: "Judicial",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://www.dccourts.gov/",
        LEGISLATION: "",
      },
    }],
  };
  const dcgisFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return dcgisRowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher: dcgisFetcher })),
    dataDir,
  );
  const dcgisCourtKinds = workbench.db.prepare(
    "select entity_id as entityId, kind from canonical_entities where entity_id in ('dc.court_of_appeals', 'dc.superior_court') order by entity_id",
  ).all() as Array<{ entityId: string; kind: string }>;
  assertEquals(dcgisCourtKinds, [
    { entityId: "dc.court_of_appeals", kind: "agency" },
    { entityId: "dc.superior_court", kind: "agency" },
  ]);

  const courtsFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.dccourts.gov/":
          return dcCourtsHomeFixture;
        case "https://www.dccourts.gov/court-of-appeals":
          return dcCourtOfAppealsFixture;
        case "https://www.dccourts.gov/superior-court":
          return dcSuperiorCourtFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dccourts.structure").run(
      createConnectorContext({ fetcher: courtsFetcher }),
    ),
    dataDir,
  );
  workbench.close();

  const reopenedAfterImport = new Workbench(dbPath);
  reopenedAfterImport.init();
  const remainingEntityReview = reopenedAfterImport.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.dccourts.structure",
  });
  const acceptedAfterImport = reopenedAfterImport.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const courtRowsAfterImport = reopenedAfterImport.db.prepare(
    "select entity_id as entityId, name, kind, branch, cluster from canonical_entities where entity_id in ('dc.court_of_appeals', 'dc.superior_court') order by entity_id",
  ).all() as Array<
    { entityId: string; name: string; kind: string; branch: string | null; cluster: string | null }
  >;
  reopenedAfterImport.close();
  assertEquals(remainingEntityReview.length, 0);
  assertEquals(acceptedAfterImport.length, 11);
  assertEquals(courtRowsAfterImport, [
    {
      entityId: "dc.court_of_appeals",
      name: "Court of Appeals",
      kind: "court",
      branch: "Judicial",
      cluster: "Judicial",
    },
    {
      entityId: "dc.superior_court",
      name: "Superior Court",
      kind: "court",
      branch: "Judicial",
      cluster: "Judicial",
    },
  ]);

  const entityBatch = await new Deno.Command(Deno.execPath(), {
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
      "--subject-prefix",
      "candidate.dccourts.structure",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const relationshipBatch = await new Deno.Command(Deno.execPath(), {
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
      "relationships",
      "--subject-prefix",
      "relationship.dccourts.structure",
      "--relationship-type",
      "part_of",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(relationshipBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedRelationships = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopened.close();
  assertEquals(acceptedRelationships.length, 11);
  assert(
    acceptedRelationships.some((row) =>
      row.relationshipId === "dc.court_of_appeals:part_of:dc.district_of_columbia_courts"
    ),
  );
});

Deno.test("BEGA structure upgrades earlier DCGIS taxonomy for the same entity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const dcgisRowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 1138,
        AGENCY_NAME: "Board of Ethics and Government Accountability",
        TYPE: "Agency",
        BRANCH: "Other",
        MAYORAL_CLUSTER: "Government Operations",
        WEB_URL: "https://bega.dc.gov/",
        LEGISLATION: "",
      },
    }],
  };
  const dcgisFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return dcgisRowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher: dcgisFetcher })),
    dataDir,
  );
  const dcgisBega = workbench.db.prepare(
    "select kind, branch, cluster from canonical_entities where entity_id = 'dc.board_of_ethics_and_government_accountability'",
  ).get() as { kind: string; branch: string | null; cluster: string | null };
  assertEquals(dcgisBega, { kind: "board", branch: null, cluster: null });

  const begaFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://bega.dc.gov/node/61616/":
          return begaAboutFixture;
        case "https://bega.dc.gov/page/office-government-ethics":
          return begaOgeFixture;
        case "https://www.open-dc.gov/office-open-government":
          return begaOogFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("bega.structure").run(createConnectorContext({ fetcher: begaFetcher })),
    dataDir,
  );

  const remainingBegaReview = workbench.listReviewItems({
    mode: "entities",
    sourceId: "bega.structure",
  });
  const upgradedBega = workbench.db.prepare(
    "select kind, branch, cluster, official_url as officialUrl from canonical_entities where entity_id = 'dc.board_of_ethics_and_government_accountability'",
  ).get() as { kind: string; branch: string | null; cluster: string | null; officialUrl: string };
  workbench.close();
  assertEquals(remainingBegaReview.length, 0);
  assertEquals(upgradedBega, {
    kind: "agency",
    branch: "Independent",
    cluster: "Ethics and Open Government",
    officialUrl: "https://bega.dc.gov/node/61616/",
  });
});

Deno.test("BEGA structure entities auto-promote and structural relationships no longer wait for batch accept-safe", async () => {
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
        case "https://bega.dc.gov/node/61616/":
          return begaAboutFixture;
        case "https://bega.dc.gov/page/office-government-ethics":
          return begaOgeFixture;
        case "https://www.open-dc.gov/office-open-government":
          return begaOogFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("bega.structure").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const reopenedAfterImport = new Workbench(dbPath);
  reopenedAfterImport.init();
  const remainingEntityReview = reopenedAfterImport.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.bega.structure",
  });
  const acceptedAfterImport = reopenedAfterImport.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopenedAfterImport.close();
  assertEquals(remainingEntityReview.length, 0);
  assertEquals(acceptedAfterImport.length, 2);

  const entityBatch = await new Deno.Command(Deno.execPath(), {
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
      "--subject-prefix",
      "candidate.bega.structure",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const relationshipBatch = await new Deno.Command(Deno.execPath(), {
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
      "relationships",
      "--subject-prefix",
      "relationship.bega.structure",
      "--relationship-type",
      "part_of",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(relationshipBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedRelationships = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopened.close();
  assertEquals(acceptedRelationships.length, 2);
  assert(
    acceptedRelationships.some((row) =>
      row.relationshipId ===
        "dc.office_of_government_ethics:part_of:dc.board_of_ethics_and_government_accountability"
    ),
  );
  assert(
    acceptedRelationships.some((row) =>
      row.relationshipId ===
        "dc.office_of_open_government:part_of:dc.board_of_ethics_and_government_accountability"
    ),
  );
});
