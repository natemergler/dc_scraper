import { assertEquals } from "@std/assert";

import { sourceCoveragePipelineStatuses } from "../../../src/export/export.ts";
import { dcRuntime } from "../../../src/jurisdictions/dc/index.ts";

Deno.test("DC source coverage includes contract inventory backlog categories", () => {
  const coverageBySource = new Map(
    dcRuntime.sourceCoverage.map((coverage) => [coverage.source, coverage]),
  );

  for (
    const source of [
      "inventory.open_data_catalog",
      "inventory.administrative_datasets",
      "inventory.budget_finance",
      "inventory.procurement_contracting",
      "inventory.permits_licenses",
      "inventory.property_land",
      "inventory.public_safety_crime",
      "inventory.elections",
      "inventory.legislation_lims",
      "inventory.dc_laws",
      "inventory.federal_laws_codified",
      "inventory.dcmr",
      "inventory.dcr",
      "inventory.mayors_orders",
      "inventory.mayors_memoranda",
      "inventory.oah",
      "inventory.oag",
      "inventory.dc_courts_legal",
      "inventory.home_rule_act",
      "inventory.mota_quickbase",
    ]
  ) {
    const coverage = coverageBySource.get(source);
    assertEquals(coverage?.sourceType, "inventory.backlog");
    assertEquals(Boolean(coverage?.publisher), true);
    assertEquals(Boolean(coverage?.accessMethod), true);
    assertEquals(Boolean(coverage?.sourceUrl), true);
    assertEquals(Boolean(coverage?.catalogConfidence), true);
    assertEquals(coverage?.contributes.includes("Contract-visible"), true);
  }
});

Deno.test("DC administrative datasets inventory row stays backlog-only", () => {
  const coverage = dcRuntime.sourceCoverage.find((coverage) =>
    coverage.source === "inventory.administrative_datasets"
  );
  const openDataCoverage = dcRuntime.sourceCoverage.find((coverage) =>
    coverage.source === "inventory.open_data_catalog"
  );

  assertEquals(coverage?.sourceType, "inventory.backlog");
  assertEquals(coverage?.family, "administrative_datasets");
  assertEquals(coverage?.sourceUrl, "https://opendata.dc.gov/");
  assertEquals(coverage?.contributes.includes("no alpha administrative-dataset reader"), true);
  assertEquals(coverage?.excludes.includes("operational record ingestion"), true);
  assertEquals(openDataCoverage?.family, "source_inventory");

  const statuses = sourceCoveragePipelineStatuses({
    catalogItem: coverage,
    snapshotCount: 0,
    recordCount: 0,
    citationCount: 0,
  });
  assertEquals(statuses, {
    readerStatus: "inventory_only",
    interpreterStatus: "not_wired",
    releaseStatus: "inventory_only",
  });
});

Deno.test("README names contract inventory-only backlog categories", async () => {
  const readme = await Deno.readTextFile(new URL("../../../README.md", import.meta.url));
  const normalizedReadme = readme.replaceAll(/\s+/g, " ");
  const inventoryRows = dcRuntime.sourceCoverage.filter((coverage) =>
    coverage.sourceType === "inventory.backlog"
  );

  assertEquals(inventoryRows.length > 0, true);
  for (
    const term of [
      "Open Data catalog surfaces",
      "administrative datasets",
      "budget/finance",
      "procurement/contracting",
      "permits/licenses",
      "property/land",
      "public safety/crime",
      "elections",
      "legislation/LIMS",
      "MOTA Quickbase-style public-body data",
      "D.C. laws",
      "federal-law context",
      "DCMR",
      "DCR",
      "Mayor's Orders and Memoranda",
      "OAH/OAG",
      "court legal materials",
      "Home Rule Act",
    ]
  ) {
    assertEquals(normalizedReadme.includes(term), true);
  }
});

Deno.test("README explains evidence trace and old CSV boundary", async () => {
  const readme = await Deno.readTextFile(new URL("../../../README.md", import.meta.url));
  const normalizedReadme = readme.replaceAll(/\s+/g, " ");

  for (
    const phrase of [
      "The old CSV packet remains useful as a checklist and vocabulary seed. It is not treated as current authority.",
      "source record -> interpreted entry fragment -> citation -> relation -> committed state -> export",
      "dcgis.ancs record 8F",
      "oanc.profiles record 6/8F",
      "ledger/dc/revisions/2026-06-16-anc-8f-oanc-profile-enrichment.json",
      "dc.anc:8F",
      "ANC 6/8F",
      "dc.smd:8F01",
      "dc.smd:8F05",
      "preserve the OANC label and profile evidence without silently replacing the DCGIS canonical identity",
    ]
  ) {
    assertEquals(normalizedReadme.includes(phrase), true);
  }
});

Deno.test("README and ADR explain collected-empty authority coverage", async () => {
  const readme = await Deno.readTextFile(new URL("../../../README.md", import.meta.url));
  const adr = await Deno.readTextFile(
    new URL("../../../docs/adr/0001-alpha-release-scope.md", import.meta.url),
  );
  const normalizedReadme = readme.replaceAll(/\s+/g, " ");
  const normalizedAdr = adr.replaceAll(/\s+/g, " ");
  const authorityCoverage = dcRuntime.sourceCoverage.find((coverage) =>
    coverage.source === "dcgis.authorities"
  );

  assertEquals(authorityCoverage?.notes?.includes("collected-empty source coverage"), true);
  assertEquals(
    normalizedReadme.includes("current live DCGIS authority layer is collected-empty"),
    true,
  );
  assertEquals(normalizedReadme.includes("zero `dc.authority` entries"), true);
  assertEquals(normalizedReadme.includes("zero authority affiliation rows"), true);
  assertEquals(
    normalizedAdr.includes("authority affiliation view is still emitted"),
    true,
  );
  assertEquals(normalizedAdr.includes("live DCGIS authority source is collected-empty"), true);
});

Deno.test("DC legal inventory rows stay distinct from legal authority entries", () => {
  const legalInventory = dcRuntime.sourceCoverage.filter((coverage) =>
    coverage.family === "legal_provenance" && coverage.sourceType === "inventory.backlog"
  );

  assertEquals(
    legalInventory.map((coverage) => coverage.source).sort(),
    [
      "inventory.dc_courts_legal",
      "inventory.dc_laws",
      "inventory.dcmr",
      "inventory.dcr",
      "inventory.federal_laws_codified",
      "inventory.home_rule_act",
      "inventory.mayors_memoranda",
      "inventory.mayors_orders",
      "inventory.oag",
      "inventory.oah",
    ],
  );

  for (const coverage of legalInventory) {
    assertEquals(
      coverage.contributes.includes("legal-source inventory row") ||
        coverage.contributes.includes("legal institution") ||
        coverage.contributes.includes("legal/court materials"),
      true,
    );
  }
});

Deno.test("DC source coverage records publisher access method source URL and confidence", () => {
  for (const coverage of dcRuntime.sourceCoverage) {
    assertEquals(typeof coverage.publisher, "string");
    assertEquals(coverage.publisher.length > 0, true);
    assertEquals(typeof coverage.accessMethod, "string");
    assertEquals(coverage.accessMethod.length > 0, true);
    assertEquals(typeof coverage.sourceUrl, "string");
    assertEquals(coverage.sourceUrl.length > 0, true);
    assertEquals(typeof coverage.catalogConfidence, "string");
    assertEquals(["high", "medium"].includes(coverage.catalogConfidence), true);
  }
});
