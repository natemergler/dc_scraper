import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { stringify } from "@std/yaml";

export async function makeTempRepo(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "dc-civic-content-test-" });
  for (
    const dir of [
      "records/sources",
      "records/legal_materials",
      "records/units",
      "records/relationship_types",
      "records/relationships",
      "records/pipelines",
      "records/gaps",
      "checks",
      "releases",
    ]
  ) {
    await ensureDir(join(root, dir));
  }
  return root;
}

export async function writeYaml(path: string, value: unknown): Promise<void> {
  await ensureDir(path.split("/").slice(0, -1).join("/"));
  await Deno.writeTextFile(path, stringify(value));
}

export async function writeFixtureRecords(repoPath: string): Promise<void> {
  await writeYaml(join(repoPath, "records/sources/open_data_dc.yml"), {
    id: "open_data_dc",
    record_type: "source",
    name: "Open Data DC",
    official_url: "https://opendata.dc.gov/",
    source_type: "portal",
    status: "active",
    source_refs: ["open_data_dc"],
  });

  await writeYaml(join(repoPath, "records/legal_materials/home_rule_act.yml"), {
    id: "home_rule_act",
    record_type: "legal_material",
    name: "District of Columbia Home Rule Act",
    law_family: "statutory",
    update_tracking_model: "congressional_review",
    status: "active",
    source_refs: ["open_data_dc"],
  });

  await writeYaml(join(repoPath, "records/units/dc.mayor.yml"), {
    id: "dc.mayor",
    record_type: "civic_unit",
    name: "Mayor of the District of Columbia",
    unit_kind: "elected_office",
    operating_layers: ["municipal", "state_equivalent"],
    status: "needs_review",
    source_refs: ["open_data_dc"],
  });

  await writeYaml(join(repoPath, "records/relationship_types/appoints.yml"), {
    id: "appoints",
    record_type: "relationship_type",
    name: "appoints",
    definition: "Actor appoints another civic unit or office.",
    status: "active",
    source_refs: ["open_data_dc"],
  });

  await writeYaml(join(repoPath, "records/relationships/dc.mayor.appoints.dc.cfo.yml"), {
    id: "dc.mayor.appoints.dc.cfo",
    record_type: "relationship",
    name: "Mayor appoints Chief Financial Officer",
    relationship_type_id: "appoints",
    source_actor: { kind: "civic_unit", id: "dc.mayor" },
    target_actor: { kind: "external", name: "Chief Financial Officer confirmation process" },
    status: "partial",
    source_refs: ["open_data_dc"],
  });

  await writeYaml(join(repoPath, "records/pipelines/official_registry.yml"), {
    id: "official_registry",
    record_type: "pipeline",
    name: "Official registry refresh",
    update_strategy: "Fetch DCGIS registry snapshots and review generated candidates.",
    status: "planned",
    source_refs: ["open_data_dc"],
  });

  await writeYaml(join(repoPath, "records/gaps/legal_authority_crosswalk.yml"), {
    id: "legal_authority_crosswalk",
    record_type: "gap",
    name: "Legal authority crosswalk incomplete",
    severity: "warning",
    release_relevant: true,
    description: "Thin fixture gap proving caveat generation.",
    status: "open",
    source_refs: ["open_data_dc"],
  });
}
