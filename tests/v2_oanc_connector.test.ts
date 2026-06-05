import { assert, assertEquals } from "@std/assert";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import {
  ancListingFixture,
  ancProfile34gFixture,
  ancProfile6cFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("OANC ANC profiles connector captures wards, SMDs, and commissioners without contact data", async () => {
  const progressMessages: string[] = [];
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://oanc.dc.gov/anc-profile-listing":
          return ancListingFixture;
        case "https://oanc.dc.gov/anc-profile/anc-34g":
          return ancProfile34gFixture;
        case "https://oanc.dc.gov/anc-profile/anc-6c":
          return ancProfile6cFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("oanc.anc_profiles").run(
    createConnectorContext({
      fetcher,
      limit: 2,
      onProgress: (event) => progressMessages.push(event.message),
    }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 3);
  assertEquals(parsed.legalRefs?.length, 2);
  const anc34gItem = parsed.items?.find((item) => item.itemKey === "anc-34g");
  const anc6cItem = parsed.items?.find((item) => item.itemKey === "anc-6c");
  const anc34gBody = anc34gItem?.body as {
    wardNumbers?: number[];
    commissioners?: Array<{ smd: string; name: string; role?: string }>;
  };
  const anc6cBody = anc6cItem?.body as {
    wardNumbers?: number[];
    commissioners?: Array<{ smd: string; name: string; role?: string }>;
  };
  assertEquals(anc34gBody.wardNumbers, [3, 4]);
  assertEquals(anc6cBody.wardNumbers, [6]);
  assertEquals(anc34gBody.commissioners?.[0].role, "Vice Chairperson");
  assertEquals(anc6cBody.commissioners?.[1].role, "Chairperson");
  assertEquals(anc6cBody.commissioners?.[3], {
    smd: "6C04",
    name: "Audra Grant",
    role: "Vice-Chairperson",
  });
  assertEquals(anc34gBody.commissioners?.[2], {
    smd: "3/4G03",
    name: "Brian A. Glover",
    role: "Sergeant-at-Arms",
  });
  assertEquals(anc34gBody.commissioners?.[3], {
    smd: "3/4G04",
    name: "Carole L. Feld",
    role: "Chairperson/Secretary",
  });
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Advisory Neighborhood Commissions"
    ),
  );
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "ANC 3/4G"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 3"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 4"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "SMD 6C01"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Audra Grant"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Brian A. Glover"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Carole L. Feld"));
  assertEquals(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name.includes("Vice-Chairperson") ||
      candidate.name.includes("Sergeant-at-Arms") ||
      candidate.name.includes("Chairperson/Secretary")
    ),
    false,
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "part_of" && candidate.toEntityRef === buildEntityId("Ward 3")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "part_of" && candidate.toEntityRef === buildEntityId("Ward 4")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("SMD 6C01")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "member_of" &&
      candidate.toEntityRef === buildEntityId("ANC 6C")
    ),
  );
  assertEquals(progressMessages, [
    "Fetching OANC ANC listing page",
    "Fetching OANC ANC profile 1/2: ANC 3/4G",
    "Fetching OANC ANC profile 2/2: ANC 6C",
  ]);
});
