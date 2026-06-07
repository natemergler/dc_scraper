import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";
import { ArcGISTableReader } from "../../src/readers/arcgis_table.ts";

Deno.test("ArcGIS reader paginates and emits snapshots and records", async () => {
  const responses = new Map<string, Record<string, unknown>>([
    [
      "0",
      {
        features: [
          { attributes: { OBJECTID: 1, Name: "Metro" } },
          { attributes: { OBJECTID: 2, Name: "Police" } },
        ],
        objectIdFieldName: "OBJECTID",
        exceededTransferLimit: true,
      },
    ],
    [
      "2",
      {
        features: [
          { attributes: { OBJECTID: 3, Name: "School" } },
        ],
        objectIdFieldName: "OBJECTID",
        exceededTransferLimit: false,
      },
    ],
  ]);

  const reader = new ArcGISTableReader({
    fetcher: async (input: string) => {
      const url = new URL(input);
      const offset = url.searchParams.get("resultOffset") ?? "0";
      const match = responses.get(offset);
      if (!match) {
        return new Response("unknown page", { status: 404 });
      }
      return new Response(JSON.stringify(match), {
        status: 200,
      });
    },
    defaultPageSize: 2,
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/civic-reader-workspace" },
    source: {
      id: "dcgis.agencies",
      jurisdiction: "dc",
      type: "arcgis.table",
      tableUrl: "https://example.com/arcgis",
      pageSize: 2,
    },
    limit: undefined,
  });

  assertEquals(result.snapshots.length, 2);
  assertEquals(result.records.length, 3);
  assertEquals(result.snapshots[0].key, "page-0");
  assertEquals(result.snapshots[1].key, "page-1");
  assertEquals(result.records[0].key, "1");
  assertEquals(result.records[1].key, "2");
  assertEquals(result.records[2].key, "3");
});

Deno.test("ArcGIS reader enforces snapshot limit", async () => {
  const responses = new Map<string, Record<string, unknown>>([
    [
      "0",
      {
        features: [
          { attributes: { OBJECTID: 1, Name: "Metro" } },
          { attributes: { OBJECTID: 2, Name: "Police" } },
          { attributes: { OBJECTID: 3, Name: "School" } },
        ],
        exceededTransferLimit: true,
      },
    ],
    [
      "2",
      {
        features: [{ attributes: { OBJECTID: 3, Name: "School" } }],
        exceededTransferLimit: false,
      },
    ],
  ]);

  const reader = new ArcGISTableReader({
    fetcher: async (input: string) => {
      const url = new URL(input);
      const offset = url.searchParams.get("resultOffset") ?? "0";
      const match = responses.get(offset);
      if (!match) {
        return new Response("unknown page", { status: 404 });
      }
      return new Response(JSON.stringify(match), {
        status: 200,
      });
    },
    defaultPageSize: 2,
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/civic-reader-workspace" },
    source: {
      id: "dcgis.agencies",
      jurisdiction: "dc",
      type: "arcgis.table",
      tableUrl: "https://example.com/arcgis",
      pageSize: 2,
    },
    limit: 2,
  });

  assertEquals(result.snapshots.length, 1);
  assertEquals(result.records.length, 2);
  assertEquals(result.records.map((r) => r.key), ["1", "2"]);
});

Deno.test("ArcGIS reader surfaces ArcGIS API error payload", async () => {
  const reader = new ArcGISTableReader({
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Invalid query",
            },
          }),
          { status: 200 },
        ),
      ),
  });

  await assertRejects(
    () =>
      reader.collect({
        workspace: { root: "/tmp/civic-reader-workspace" },
        source: {
          id: "dcgis.agencies",
          jurisdiction: "dc",
          type: "arcgis.table",
          tableUrl: "https://example.com/arcgis",
        },
      }),
    Error,
    "ArcGIS query error for dcgis.agencies: Invalid query",
  );
});
