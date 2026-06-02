import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { legalEntrypointsFixture } from "./helpers/v2_fixtures.ts";

Deno.test("normalized needsReview=false legal refs auto-accept during import", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));

  await workbench.importConnectorResult(result, dataDir);

  const statuses = workbench.db.prepare(
    "select review_status as reviewStatus, count(*) as count from legal_refs group by review_status",
  ).all() as Array<{ reviewStatus: string; count: number }>;
  const statusCounts = new Map(statuses.map((row) => [row.reviewStatus, row.count]));
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  assertEquals(statusCounts.get("accepted"), 2);
  assertEquals(statusCounts.get("pending"), 1);
  assertEquals(openItems.length, 1);
  assertEquals(openItems[0]?.details.refType, "dc_register");
  assertEquals(openItems[0]?.details.needsReview, true);
});
