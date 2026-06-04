import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { legalEntrypointsFixture } from "./helpers/v2_fixtures.ts";
import { syntheticLegalRefSourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("recognized legal entrypoints auto-accept without generic navigation review", async () => {
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

  assertEquals(statusCounts.get("accepted"), 3);
  assertEquals(statusCounts.get("pending"), undefined);
  assertEquals(openItems.length, 0);
});

Deno.test("recognized legal citation families auto-accept on current schema", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  for (
    const [legalRefId, citationText] of [
      ["legal.test.signature.legal_refs.dc_law", "D.C. Law 22-155"],
      ["legal.test.signature.legal_refs.dc_act", "REACH Act (D.C. Act 23-521)"],
      ["legal.test.signature.legal_refs.public_law", "Public Law 89-774"],
      ["legal.test.signature.legal_refs.us_code", "33 U.S. Code § 1267"],
      ["legal.test.signature.legal_refs.dc_bill", "B21-0697"],
      [
        "legal.test.signature.legal_refs.reorganization_plan",
        "DC ST D.I, T. 1, Ch.15, Subch. XIV, Pt. A, 1996 Plan 4",
      ],
    ] as const
  ) {
    await workbench.importConnectorResult(
      syntheticLegalRefSourceResult(legalRefId, citationText, "https://example.com/legal", {
        needsReview: false,
        sourceItemKey: legalRefId,
      }),
      dataDir,
    );
  }

  const rows = workbench.db.prepare(
    "select ref_type as refType, review_status as reviewStatus, normalized_citation as normalizedCitation from legal_refs order by ref_type",
  ).all() as Array<{ refType: string; reviewStatus: string; normalizedCitation: string }>;
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(rows, [
    { refType: "dc_act", reviewStatus: "accepted", normalizedCitation: "D.C. Act 23-521" },
    { refType: "dc_bill", reviewStatus: "accepted", normalizedCitation: "D.C. Bill B21-0697" },
    { refType: "dc_law", reviewStatus: "accepted", normalizedCitation: "D.C. Law 22-155" },
    { refType: "public_law", reviewStatus: "accepted", normalizedCitation: "Public Law 89-774" },
    {
      refType: "reorganization_plan",
      reviewStatus: "accepted",
      normalizedCitation: "Reorganization Plan No. 4 of 1996",
    },
    { refType: "us_code", reviewStatus: "accepted", normalizedCitation: "33 U.S.C. § 1267" },
  ]);
});
