import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  councilMembersFixture,
} from "./helpers/v2_fixtures.ts";
import { syntheticCustomEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";

function councilMembersFetcher() {
  return async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return councilMembersFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
}

Deno.test("Council members connector captures seats and ward representations", async () => {
  const result = await getConnector("council.members").run(
    createConnectorContext({ fetcher: councilMembersFetcher() }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 1);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Council of the District of Columbia" &&
      candidate.kind === "council" &&
      candidate.officialUrl === "https://dccouncil.gov/"
    ),
  );
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Council Chairman"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "District of Columbia"));
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "holds" && candidate.rawValue === "Council Chairman"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 6")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("District of Columbia")
    ),
  );
});

Deno.test("Council member source upgrades stale DCGIS Council official URL", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.council",
      sourceItemKey: "dcgis-council-row",
      proposedEntityId: "dc.council_of_the_district_of_columbia",
      name: "Council of the District of Columbia",
      kind: "council",
      officialUrl: "https://dccouncil.us/",
      observedName: "Council of the District of Columbia",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("council.members").run(createConnectorContext({
      fetcher: councilMembersFetcher(),
    })),
    dataDir,
  );

  const council = workbench.db.prepare(
    `select official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.council_of_the_district_of_columbia'`,
  ).get() as { officialUrl: string | null; mergedCandidateIds: string };
  workbench.close();

  assertEquals(council.officialUrl, "https://dccouncil.gov/");
  assertEquals(JSON.parse(council.mergedCandidateIds), [
    "candidate.dcgis.agencies.council",
    "candidate.council.members.council_of_the_district_of_columbia",
  ]);
});

Deno.test("Council members connector ignores limit for the single-page roster", async () => {
  const result = await getConnector("council.members").run(createConnectorContext({
    fetcher: councilMembersFetcher(),
    limit: 1,
  }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Ward 7 Councilmember Wendell Felder"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 8")
    ),
  );
});

Deno.test("Council ward parsing skips order inference when a ward label is absent", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return `
<html><body>
  <main>
    <h3>Ward Members</h3>
    <ul>
      <li><a href="https://dccouncil.gov/council/charles-allen/">Councilmember Charles Allen</a></li>
    </ul>
  </main>
</body></html>
`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.members").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) => candidate.name === "Councilmember Charles Allen"),
  );
  assert(
    !parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 1 Council Seat"),
  );
  assert(
    !parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 1")
    ),
  );
});

Deno.test("Council committee member parsing captures chair and member relationships", async () => {
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
  const chairs =
    parsed.relationshipCandidates?.filter((candidate) => candidate.relationshipType === "chairs") ??
      [];
  const members =
    parsed.relationshipCandidates?.filter((candidate) =>
      candidate.relationshipType === "member_of"
    ) ?? [];
  assertEquals(chairs.length, 1);
  assert(
    chairs.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("At-Large Councilmember Christina Henderson") &&
      candidate.toEntityRef === buildEntityId("Committee on Health")
    ),
  );
  assert(
    members.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("Ward 6 Councilmember Charles Allen") &&
      candidate.toEntityRef === buildEntityId("Committee on Health")
    ),
  );
  assert(
    members.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("At-Large Councilmember Christina Henderson")
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
  const oversightCandidates =
    parsed.relationshipCandidates?.filter((candidate) =>
      candidate.relationshipType === "overseen_by"
    ) ?? [];
  assertEquals(oversightCandidates.length, 4);
  assert(
    oversightCandidates.every((candidate) =>
      candidate.sourceItemKey.includes(":oversight") && candidate.needsReview === true
    ),
  );
  assertEquals(
    oversightCandidates.some((candidate) => candidate.rawValue === "twitter"),
    false,
  );
  assertEquals(
    oversightCandidates.some((candidate) =>
      candidate.rawValue ===
        "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health"
    ),
    false,
  );
  assert(
    oversightCandidates.some((candidate) =>
      candidate.rawValue === "Department of Health" &&
      candidate.fromEntityRef === "dc.dc_health"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) =>
      item.subjectId === "relationship.council.committees.committee_on_health_oversight_2" &&
      item.reason === "Review Council committee oversight relationship"
    ),
  );
});

Deno.test("Council oversight targets default to accept except exclusion targets", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture.replace(
            "</ul>",
            "<li>Council of the District of Columbia</li></ul>",
          );
        case "https://dccouncil.gov/committees/committee-on-health/":
          return `<html><body>
            <h1>Committee on Health</h1>
            <h2>Agencies Under This Committee</h2>
            <ul>
              <li>Department of Health</li>
              <li>Cedar Hill Hospital</li>
              <li>Pay-As-You-Go Capital</li>
              <li>Committee on Facilities and Procurement</li>
              <li>Department of Buildings (including construction codes)</li>
              <li>Office of the Attorney General (jointly, only for oversight purposes, with the Committee on the Judiciary and Public Safety)</li>
              <li>Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)</li>
              <li>All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health</li>
            </ul>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults[0].parsed?.reviewItems ?? [];
  const healthItem = items.find((item) =>
    item.details.rawValue === "Department of Health" &&
    item.subjectId.includes("committee_on_health_oversight")
  );
  const parsed = result.endpointResults[0].parsed;
  const cedarHillItem = items.find((item) => item.details.rawValue === "Cedar Hill Hospital");
  const paygoItem = items.find((item) => item.details.rawValue === "Pay-As-You-Go Capital");
  const paygoRelationshipCandidate = parsed?.relationshipCandidates?.find((candidate) =>
    candidate.rawValue === "Pay-As-You-Go Capital"
  );
  const facilitiesItem = items.find((item) =>
    item.details.rawValue === "Committee on Facilities and Procurement"
  );
  const includingItem = items.find((item) =>
    item.details.rawValue === "Department of Buildings (including construction codes)"
  );
  const jointlyItem = items.find((item) =>
    item.details.rawValue ===
      "Office of the Attorney General (jointly, only for oversight purposes, with the Committee on the Judiciary and Public Safety)"
  );
  const excludingItem = items.find((item) =>
    item.details.rawValue ===
      "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)"
  );
  const groupedItem = items.find((item) =>
    item.details.rawValue ===
      "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health"
  );
  const councilItem = items.find((item) =>
    item.details.rawValue === "Council of the District of Columbia"
  );

  assertEquals(healthItem?.defaultAction, "accept");
  assertEquals(cedarHillItem?.defaultAction, "accept");
  assertEquals(paygoItem?.itemType, "source_status");
  assertEquals(paygoItem?.defaultAction, "defer");
  assertEquals(
    paygoItem?.details.whyDeferred,
    "Oversight text names a fund or financing bucket rather than a clearly modeled civic body, so the compact edge stays in review.",
  );
  assertEquals(paygoRelationshipCandidate, undefined);
  assertEquals(facilitiesItem?.defaultAction, "accept");
  assertEquals(includingItem?.defaultAction, "accept");
  assertEquals(jointlyItem?.defaultAction, "accept");
  assertEquals(excludingItem?.defaultAction, "defer");
  assertEquals(
    excludingItem?.details.whyDeferred,
    "Oversight text uses exclusion wording, so the compact edge needs a human decision.",
  );
  assertEquals(councilItem?.defaultAction, "accept");
  assertEquals(groupedItem, undefined);
});
