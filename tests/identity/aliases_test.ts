import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { cite } from "../../src/core/types.ts";
import {
  buildIdentityAliasResolver,
  loadIdentityAliases,
  parseIdentityAliasPayload,
} from "../../src/identity/aliases.ts";

Deno.test("loadIdentityAliases reads grouped declarative alias files", async () => {
  const identityRoot = await Deno.makeTempDir({ prefix: "civic-ledger-identity-valid-" });
  try {
    await Deno.writeTextFile(
      join(identityRoot, "dcgis-agencies.json"),
      JSON.stringify({
        schemaVersion: 1,
        jurisdiction: "dc",
        aliases: [{
          id: "dcgis-agency-1052",
          canonicalId: "dc.agency:executive-office-of-the-mayor",
          previousIds: ["dc.agency:1052"],
          sourceRefs: [{ source: "dcgis.agencies", sourceRecordId: "45" }],
          kind: "dc.agency",
          name: "Executive Office of the Mayor",
          rationale: "DCGIS source agency ID migrated to a civic slug.",
          evidence: [{ source: "dcgis.agencies", sourceRecordId: "45" }],
        }],
      }),
    );

    const aliases = await loadIdentityAliases(identityRoot);
    assertEquals(aliases.length, 1);
    assertEquals(aliases[0].canonicalId, "dc.agency:executive-office-of-the-mayor");
    assertEquals(aliases[0].previousIds, ["dc.agency:1052"]);
    assertEquals(aliases[0].sourceRefs, [{ source: "dcgis.agencies", sourceRecordId: "45" }]);
  } finally {
    await Deno.remove(identityRoot, { recursive: true });
  }
});

Deno.test("identity resolver resolves previous IDs and source refs", () => {
  const [alias] = parseIdentityAliasPayload("identity.json", {
    id: "dcgis-agency-1138",
    canonicalId: "dc.agency:board-of-ethics-and-government-accountability",
    previousIds: ["dc.agency:1138"],
    sourceRefs: [{ source: "dcgis.agencies", sourceRecordId: "118" }],
    rationale: "DCGIS agency ID migrated to civic slug.",
  });

  const resolver = buildIdentityAliasResolver([alias]);

  assertEquals(resolver.resolvePreviousId("dc.agency:1138"), {
    status: "resolved",
    input: "dc.agency:1138",
    canonicalId: "dc.agency:board-of-ethics-and-government-accountability",
    aliases: [alias],
  });
  assertEquals(resolver.resolveSourceRef(cite("dcgis.agencies", "118")), {
    status: "resolved",
    input: "dcgis.agencies|118||",
    canonicalId: "dc.agency:board-of-ethics-and-government-accountability",
    aliases: [alias],
  });
});

Deno.test("identity resolver reports ambiguous previous IDs", () => {
  const aliases = parseIdentityAliasPayload("identity.json", {
    schemaVersion: 1,
    aliases: [{
      id: "first",
      canonicalId: "dc.agency:first",
      previousIds: ["dc.agency:1"],
      rationale: "first mapping",
    }, {
      id: "second",
      canonicalId: "dc.agency:second",
      previousIds: ["dc.agency:1"],
      rationale: "second mapping",
    }],
  });

  const resolver = buildIdentityAliasResolver(aliases);

  assertEquals(resolver.issues.map((issue) => issue.code), ["identity.alias_ambiguous"]);
  assertEquals(resolver.resolvePreviousId("dc.agency:1").status, "ambiguous");
});

Deno.test("identity aliases require a previous ID or source ref", () => {
  try {
    parseIdentityAliasPayload("identity.json", {
      id: "bad",
      canonicalId: "dc.agency:bad",
      rationale: "missing selector",
    });
    throw new Error("expected parse to fail");
  } catch (error) {
    assertEquals(
      error instanceof Error && error.message.includes("previousIds or sourceRefs"),
      true,
    );
  }
});
