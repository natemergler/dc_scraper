import { assertEquals } from "@std/assert";
import { connectors } from "../src/v2/connectors.ts";
import type { SourceConnector } from "../src/v2/connectors/shared.ts";
import type { ConnectorResult, SourceDefinition } from "../src/v2/domain.ts";
import {
  runSmokeProfile,
  type SmokeWorkspacePaths,
  sourceIdsForSmokeProfile,
} from "../src/v2/smoke.ts";

function fixtureConnector(source: SourceDefinition): SourceConnector {
  return {
    sourceId: source.sourceId,
    source,
    run: async () => fixtureResult(source),
  };
}

function fixtureResult(source: SourceDefinition): ConnectorResult {
  return {
    source,
    endpointResults: [{
      endpoint: {
        endpointId: `${source.sourceId}.main`,
        sourceId: source.sourceId,
        title: `${source.title} endpoint`,
        kind: "fixture",
        url: source.baseUrl,
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [],
    }],
  };
}

Deno.test("smoke profiles resolve the intended source ids from connector metadata", () => {
  assertEquals(sourceIdsForSmokeProfile(connectors, "tier0"), [
    "dcgis.agencies",
    "dcgis.boards_commissions_councils",
    "open_dc.public_bodies",
    "mayor.office",
    "council.members",
    "council.committees",
    "legal.entrypoints",
  ]);
  assertEquals(sourceIdsForSmokeProfile(connectors, "structure"), [
    "dcgis.agencies",
    "dcgis.boards_commissions_councils",
    "dccourts.structure",
    "bega.structure",
    "open_dc.public_bodies",
    "mayor.office",
    "council.members",
    "council.committees",
    "council.lims",
    "oanc.anc_profiles",
    "mota.quickbase",
    "legal.entrypoints",
    "admin.service_requests_311",
  ]);
  assertEquals(sourceIdsForSmokeProfile(connectors, "inventory"), [
    "council.lims",
    "admin.service_requests_311",
    "admin.budget_sources",
    "admin.enterprise_dataset_inventory",
    "admin.permits_licenses",
    "admin.crime_public_safety",
    "admin.procurement_sources",
    "admin.property_land",
    "admin.elections",
  ]);
});

Deno.test("smoke runs always use temp workspace paths and fetch only the requested profile sources", async () => {
  const structureSource: SourceDefinition = {
    sourceId: "alpha.structure",
    title: "Alpha Structure",
    kind: "fixture",
    accessMethod: "fixture",
    baseUrl: "https://example.com/alpha",
    tier: "tier0",
    releaseRole: "structure",
    smokeProfiles: ["structure", "tier0"],
    privacyNotes: ["fixture structure source"],
  };
  const inventorySource: SourceDefinition = {
    sourceId: "beta.inventory",
    title: "Beta Inventory",
    kind: "fixture",
    accessMethod: "fixture",
    baseUrl: "https://example.com/beta",
    tier: "tier1",
    releaseRole: "inventory",
    smokeProfiles: ["inventory"],
    privacyNotes: ["fixture inventory source"],
  };
  const connectors = [fixtureConnector(structureSource), fixtureConnector(inventorySource)];
  const observed: {
    sourceIds?: string[];
    dbPath?: string;
    dataDir?: string;
    resolutionsDir?: string;
    limit?: number;
  } = {};

  const result = await runSmokeProfile("structure", { limit: 7 }, {
    connectors,
    makeTempDir: async () => "/tmp/dc-smoke-fixture",
    fetchSources: async (
      sourceIds: string[],
      options: { limit?: number; onProgress?: () => void },
      paths: SmokeWorkspacePaths,
    ) => {
      observed.sourceIds = sourceIds;
      observed.dbPath = paths.dbPath;
      observed.dataDir = paths.dataDir;
      observed.resolutionsDir = paths.resolutionsDir;
      observed.limit = options.limit;
      return sourceIds.map((sourceId) => ({
        sourceId,
        title: sourceId,
        status: "success" as const,
        endpointStatuses: [`${sourceId}.main:success`],
      }));
    },
    readWorkbenchStatus: async () => ({
      nextCommand: "deno task dc -- review",
      unresolvedStateNote:
        "Workbench state: open decisions=0, browse rows=0, deferred review=0, stale review=0, blocked reconciliation=0, placeholder entities=0.",
    }),
  });

  assertEquals(observed.sourceIds, ["alpha.structure"]);
  assertEquals(observed.dbPath, "/tmp/dc-smoke-fixture/workbench.sqlite");
  assertEquals(observed.dataDir, "/tmp/dc-smoke-fixture/data");
  assertEquals(observed.resolutionsDir, "/tmp/dc-smoke-fixture/resolutions");
  assertEquals(observed.limit, 7);
  assertEquals(result.workspace.rootDir, "/tmp/dc-smoke-fixture");
  assertEquals(result.workspace.dbPath, "/tmp/dc-smoke-fixture/workbench.sqlite");
  assertEquals(result.sourceIds, ["alpha.structure"]);
  assertEquals(result.successCount, 1);
  assertEquals(result.failureCount, 0);
  assertEquals(result.outcomes.length, 1);
  assertEquals(
    result.status.nextCommand,
    "deno task dc -- review --db /tmp/dc-smoke-fixture/workbench.sqlite",
  );
});
