import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildV2Release } from "../src/v2/release.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";

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

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    ready: boolean;
    reasons: string[];
    readiness: string;
  };
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable");
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
