import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildV2Release } from "../src/v2/release.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticEntitySourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("release manifest includes stable provenance fields", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.manifest.board", "Release Board"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.manifest.board",
      payload: {},
    },
    resolutionsDir,
  );
  await buildV2Release(workbench, outDir, { sourceProfile: "tier0" });
  workbench.close();

  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    manifest_version: number;
    release_id: string;
    tool_version: string;
    git_commit: string;
    source_profile: string;
  };

  assertEquals(manifest.manifest_version, 1);
  assertEquals(manifest.source_profile, "tier0");
  assert(typeof manifest.release_id === "string" && manifest.release_id.length > 0);
  assert(typeof manifest.tool_version === "string" && manifest.tool_version.length > 0);
  assert(typeof manifest.git_commit === "string" && manifest.git_commit.length > 0);
});

Deno.test("release verify exits zero for a ready workbench", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.verify.ready", "Ready Board"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.ready",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable");
});

Deno.test("release verify treats unresolved review as usable with warnings", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.verify.warning", "Warning Board"),
    dataDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    sourceArtifactProblems: unknown[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: unknown[];
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.readiness, "usable-with-warnings");
  assertEquals(body.reasons, ["open review items: 1"]);
  assertEquals(body.sourceArtifactProblems, []);
  assertEquals(body.relationshipProvenanceCheckedCount, 0);
  assertEquals(body.relationshipProvenanceProblems, []);
});

Deno.test("release verify accepts source-backed relationship rows", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare("update source_artifacts set fetched_url = 'https://fda.gov/source.json'")
    .run();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems, []);
});

Deno.test("release verify accepts camelCase relationship decision payloads", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "update resolution_events set payload_json = ? where subject_id = ?",
  ).run([
    JSON.stringify({
      resolvedFromEntityId: "dc.source_board",
      resolvedRelationshipType: "governed_by",
      resolvedToEntityId: "dc.target_agency",
    }),
    "relationship.test.release.verify.source_governed_by_target",
  ]);
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems, []);
});

Deno.test("release verify fails fast on unresolved work and bad artifact provenance", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.verify.blocked", "Blocked Board"),
    dataDir,
  );
  workbench.db.prepare("update source_artifacts set fetched_url = '/tmp/local-only.html'").run();
  workbench.close();

  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "verify",
      "--db",
      dbPath,
    ],
  }).output();

  assertEquals(output.code, 1);
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assertStringIncludes(stdout, "Release verify: not ready");
  assertStringIncludes(stdout, "open review items: 1");
  assertStringIncludes(stdout, "source artifact provenance: 1 problem");
  assertStringIncludes(stdout, "fetched_url is not a public http/https URL");
  assertEquals(stderr, "");
});

Deno.test("release verify reports accepted relationships without source evidence", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "delete from relationship_candidate_evidence where relationship_candidate_id = ?",
  ).run("relationship.test.release.verify.source_governed_by_target");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertEquals(
    body.relationshipProvenanceProblems[0].relationshipId,
    "dc.source_board:governed_by:dc.target_agency",
  );
  assertStringIncludes(
    body.relationshipProvenanceProblems[0].message,
    "missing relationship candidate evidence",
  );
});

Deno.test("release verify text reports relationship provenance problems", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "delete from relationship_candidate_evidence where relationship_candidate_id = ?",
  ).run("relationship.test.release.verify.source_governed_by_target");
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);
  const stdout = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 1);
  assertStringIncludes(stdout, "Relationship rows checked: 1 accepted relationship row.");
  assertStringIncludes(stdout, "Relationship row provenance problems:");
  assertStringIncludes(stdout, "missing relationship candidate evidence");
});

Deno.test("release verify follows relationship evidence artifact paths", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "update relationship_candidate_evidence set artifact_path = 'missing/evidence.json' where relationship_candidate_id = ?",
  ).run("relationship.test.release.verify.source_governed_by_target");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertStringIncludes(
    body.relationshipProvenanceProblems[0].message,
    "evidence artifact_path does not resolve to a source artifact",
  );
});

Deno.test("release verify reports relationship rows that drift from accepted decisions", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "update canonical_relationships set relationship_type = 'part_of' where relationship_id = ?",
  ).run("dc.source_board:governed_by:dc.target_agency");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertStringIncludes(
    body.relationshipProvenanceProblems[0].message,
    "canonical row does not match accepted relationship decision",
  );
});

Deno.test("release verify rejects private relationship evidence URLs", async () => {
  for (
    const fetchedUrl of [
      "http://localhost/source.json",
      "http://intranet/source.json",
      "http://host.docker.internal/source.json",
      "http://[::ffff:127.0.0.1]/source.json",
    ]
  ) {
    const { dbPath, workbench } = await readyRelationshipWorkbench();
    workbench.db.prepare("update source_artifacts set fetched_url = ?").run(fetchedUrl);
    workbench.close();

    const result = await runReleaseVerifyJson(dbPath);
    const body = result.body as {
      ready: boolean;
      sourceArtifactProblems: Array<{ message: string }>;
      relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
    };
    assertEquals(result.code, 1, fetchedUrl);
    assertEquals(body.ready, false, fetchedUrl);
    assertEquals(body.sourceArtifactProblems.length > 0, true, fetchedUrl);
    assertEquals(body.relationshipProvenanceProblems.length, 1, fetchedUrl);
    assertStringIncludes(
      body.relationshipProvenanceProblems[0].message,
      "fetched_url is not a public http/https URL",
    );
  }
});

async function runReleaseVerifyJson(dbPath: string): Promise<{
  code: number;
  body: unknown;
}> {
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "verify",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();

  return {
    code: output.code,
    body: JSON.parse(new TextDecoder().decode(output.stdout)),
  };
}

function runReleaseVerifyText(dbPath: string): Promise<Deno.CommandOutput> {
  return new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "verify",
      "--db",
      dbPath,
    ],
  }).output();
}

async function readyRelationshipWorkbench(): Promise<{
  dbPath: string;
  workbench: Workbench;
}> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.source_entity",
      candidateId: "candidate.test.release.verify.source_board",
      sourceItemKey: "source-board-row",
      proposedEntityId: "dc.source_board",
      name: "Source Board",
      kind: "board",
      observedName: "Source Board",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.source_board",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.target_entity",
      candidateId: "candidate.test.release.verify.target_agency",
      sourceItemKey: "target-agency-row",
      proposedEntityId: "dc.target_agency",
      name: "Target Agency",
      kind: "agency",
      observedName: "Target Agency",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.target_agency",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.release.verify.relationships",
      relationshipCandidateId: "relationship.test.release.verify.source_governed_by_target",
      sourceItemKey: "relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.test.release.verify.source_governed_by_target",
      payload: {},
    },
    resolutionsDir,
  );

  return { dbPath, workbench };
}
