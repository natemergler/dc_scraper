import { assertEquals } from "@std/assert";
import { sourceDefinitions, tier1SourceIds } from "../src/source_definitions.ts";

Deno.test("tier 1 sources include Council public schedule pages", () => {
  assertEquals(tier1SourceIds.includes("council_hearings_page"), true);
  assertEquals(tier1SourceIds.includes("council_oversight_budget_schedules"), true);
  assertEquals(tier1SourceIds.includes("dc_government_directories"), true);
  assertEquals(tier1SourceIds.includes("open_dc_public_bodies"), true);
  assertEquals(tier1SourceIds.includes("ocp_transparency_portal"), true);

  assertEquals(sourceDefinitions["council_hearings_page"], {
    id: "council_hearings_page",
    family: "council",
    kind: "page_manifest",
    title: "Council hearings page",
    url: "https://dccouncil.gov/hearings/",
  });
  assertEquals(sourceDefinitions["council_oversight_budget_schedules"], {
    id: "council_oversight_budget_schedules",
    family: "council",
    kind: "page_manifest",
    title: "Council oversight and budget schedules",
    url: "https://dccouncil.gov/2025-2026-performance-oversight-fy-2027-budget-schedules/",
  });
  assertEquals(sourceDefinitions["dc_government_directories"], {
    id: "dc_government_directories",
    family: "directory",
    kind: "page_manifest",
    title: "District Government Directories",
    url: "https://dc.gov/page/district-government-directories",
    claim_scope: "directory front door, searchable agency and office surface",
    evidence_depth: "page-manifest",
  });
  assertEquals(sourceDefinitions["open_dc_public_bodies"], {
    id: "open_dc_public_bodies",
    family: "open_dc",
    kind: "page_manifest",
    title: "Open DC Public Bodies",
    url: "https://www.open-dc.gov/public-bodies",
    claim_scope: "public-bodies front door and accountability surface",
    evidence_depth: "page-manifest",
  });
  assertEquals(sourceDefinitions["ocp_transparency_portal"], {
    id: "ocp_transparency_portal",
    family: "ocp",
    kind: "page_manifest",
    title: "OCP Contracts and Procurement Transparency Portal",
    url: "https://contracts.ocp.dc.gov/",
    claim_scope: "procurement front door and portal navigation surface",
    evidence_depth: "page-manifest",
  });
});

Deno.test("tier 1 sources include D.C. Courts official site", () => {
  assertEquals(tier1SourceIds.includes("dc_courts"), true);
  assertEquals(sourceDefinitions["dc_courts"], {
    id: "dc_courts",
    family: "courts",
    kind: "page_manifest",
    title: "District of Columbia Courts",
    url: "https://www.dccourts.gov/",
  });
});

Deno.test("tier 1 sources include deferred UI-heavy entry pages", () => {
  assertEquals(tier1SourceIds.includes("scout"), true);
  assertEquals(tier1SourceIds.includes("propertyquest"), true);

  assertEquals(sourceDefinitions["scout"], {
    id: "scout",
    family: "property",
    kind: "page_manifest",
    title: "SCOUT",
    url: "https://scout.dcra.dc.gov/",
  });
  assertEquals(sourceDefinitions["propertyquest"], {
    id: "propertyquest",
    family: "property",
    kind: "page_manifest",
    title: "PropertyQuest",
    url: "https://propertyquest.dc.gov/",
  });
});
