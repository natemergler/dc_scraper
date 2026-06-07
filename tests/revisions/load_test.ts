import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { loadRevisions } from "../../src/revisions/load.ts";

Deno.test("loadRevisions reads valid JSON revision overlays", async () => {
  const revisionRoot = await Deno.makeTempDir({ prefix: "civic-ledger-revisions-load-valid-" });

  await Deno.mkdir(revisionRoot, { recursive: true });
  await Deno.writeTextFile(
    join(revisionRoot, "rev-002.json"),
    JSON.stringify({
      id: "r2",
      source: "test",
      targetKind: "entry",
      targetId: "dc.agency:a-1",
      patch: { name: "Overridden Agency" },
    }),
  );
  await Deno.writeTextFile(
    join(revisionRoot, "note.txt"),
    "ignore this file",
  );

  try {
    const revisions = await loadRevisions(revisionRoot);

    assertEquals(revisions.length, 1);
    assertEquals(revisions[0].id, "r2");
    assertEquals(revisions[0].targetKind, "entry");
    assertEquals(revisions[0].targetId, "dc.agency:a-1");
    assertEquals(revisions[0].patch.name, "Overridden Agency");
  } finally {
    await Deno.remove(revisionRoot, { recursive: true });
  }
});

Deno.test("loadRevisions returns empty when revision root is missing", async () => {
  const root = await Deno.makeTempDir({ prefix: "civic-ledger-revisions-load-missing-" });
  const revisionRoot = join(root, "revisions");

  try {
    const revisions = await loadRevisions(revisionRoot);
    assertEquals(revisions.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("loadRevisions rejects invalid payload", async () => {
  const revisionRoot = await Deno.makeTempDir({ prefix: "civic-ledger-revisions-load-invalid-" });

  await Deno.writeTextFile(
    join(revisionRoot, "invalid.json"),
    JSON.stringify({
      id: "r-bad",
      source: "test",
      targetKind: "entry",
      targetId: "",
      patch: { name: "bad" },
    }),
  );

  try {
    await assertRejects(
      () => loadRevisions(revisionRoot),
      Error,
      "targetId must be a non-empty string",
    );
  } finally {
    await Deno.remove(revisionRoot, { recursive: true });
  }
});
