import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildEntityId } from "../src/v2/domain.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { buildV2Release } from "../src/v2/release.ts";

const mayorHomeFixture = `
<html><body>
  <a href="#main-content">Skip to main content</a>
  <h6 class="site-slogan">Executive Office of the Mayor</h6>
  <div class="caption-text-wrapper">
    <h2 class="cat-main">Mayor Muriel Bowser</h2>
    <div class="learn-more"><a href="/node/974092" title="Read Full Bio">Read Mayor Bowser's Bio</a></div>
  </div>
</body></html>
`;

Deno.test("Mayor connector derives the current officeholder from the official Mayor site", async () => {
  const result = await getConnector("mayor.office").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        assertEquals(url, "https://mayor.dc.gov/");
        return mayorHomeFixture;
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));

  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Muriel Bowser" &&
      candidate.kind === "public_official" &&
      candidate.officialUrl === "https://mayor.dc.gov/node/974092"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Mayor" &&
      candidate.kind === "office" &&
      candidate.proposedEntityId === buildEntityId("Mayor")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "holds" &&
      candidate.fromEntityRef === buildEntityId("Muriel Bowser") &&
      candidate.toEntityRef === buildEntityId("Mayor")
    ),
  );
});

Deno.test("Mayor officeholder import releases the source-backed holds fact", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();
  await workbench.importConnectorResult(
    await getConnector("mayor.office").run(createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          assertEquals(url, "https://mayor.dc.gov/");
          return mayorHomeFixture;
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    })),
    join(dir, "artifacts"),
  );

  const outDir = join(dir, "release");
  await buildV2Release(workbench, outDir, { gitCommit: "fixture", repoRoot: dir });
  workbench.close();

  const entitiesCsv = await Deno.readTextFile(join(outDir, "entities", "all_entities.csv"));
  const relationshipsCsv = await Deno.readTextFile(
    join(outDir, "relationships", "all_relationships.csv"),
  );

  assertStringIncludes(
    entitiesCsv,
    `${buildEntityId("Muriel Bowser")},Muriel Bowser,role_status_observation,public_official`,
  );
  assertStringIncludes(
    entitiesCsv,
    `${buildEntityId("Mayor")},Mayor,agency_or_office,office`,
  );
  assertStringIncludes(entitiesCsv, "https://mayor.dc.gov/");
  assertStringIncludes(
    relationshipsCsv,
    `representation_membership,holds,${buildEntityId("Muriel Bowser")},Muriel Bowser`,
  );
});
