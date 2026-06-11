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
    assertEquals(revisions[0].rationale, undefined);
    assertEquals(revisions[0].patch.name, "Overridden Agency");
  } finally {
    await Deno.remove(revisionRoot, { recursive: true });
  }
});

Deno.test("loadRevisions reads revision rationale and evidence", async () => {
  const revisionRoot = await Deno.makeTempDir({ prefix: "civic-ledger-revisions-load-evidence-" });

  await Deno.writeTextFile(
    join(revisionRoot, "suppress-shadow.json"),
    JSON.stringify({
      id: "suppress-shadow",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.board:shadow",
      rationale: "Duplicate source shadow reviewed against official source records.",
      evidence: [{ source: "dcgis.boards", sourceRecordId: "29" }],
      patch: { suppress: true },
    }),
  );

  try {
    const revisions = await loadRevisions(revisionRoot);

    assertEquals(revisions.length, 1);
    assertEquals(
      revisions[0].rationale,
      "Duplicate source shadow reviewed against official source records.",
    );
    assertEquals(revisions[0].evidence, [{ source: "dcgis.boards", sourceRecordId: "29" }]);
    assertEquals(revisions[0].patch.suppress, true);
  } finally {
    await Deno.remove(revisionRoot, { recursive: true });
  }
});

Deno.test("loadRevisions reads audited review decisions", async () => {
  const revisionRoot = await Deno.makeTempDir({ prefix: "civic-ledger-revisions-load-review-" });

  await Deno.writeTextFile(
    join(revisionRoot, "preserve-distinct.json"),
    JSON.stringify({
      id: "preserve-distinct",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.board:one",
      rationale: "Official sources use similar names but describe distinct bodies.",
      evidence: [{ source: "dcgis.boards", sourceRecordId: "1" }],
      patch: {
        review: {
          decision: "preserve_distinct",
          relatedEntryIds: ["dc.board:two"],
        },
      },
    }),
  );

  try {
    const revisions = await loadRevisions(revisionRoot);

    assertEquals(revisions.length, 1);
    assertEquals(
      revisions[0].rationale,
      "Official sources use similar names but describe distinct bodies.",
    );
    assertEquals(revisions[0].patch.review, {
      decision: "preserve_distinct",
      relatedEntryIds: ["dc.board:two"],
    });
  } finally {
    await Deno.remove(revisionRoot, { recursive: true });
  }
});

Deno.test("loadRevisions requires rationale for review revisions", async () => {
  const revisionRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-revisions-load-review-bad-",
  });

  await Deno.writeTextFile(
    join(revisionRoot, "review-without-rationale.json"),
    JSON.stringify({
      id: "review-bad",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.board:one",
      patch: {
        review: {
          decision: "preserve_distinct",
          relatedEntryIds: ["dc.board:two"],
        },
      },
    }),
  );

  try {
    await assertRejects(
      () => loadRevisions(revisionRoot),
      Error,
      "review revisions require rationale",
    );
  } finally {
    await Deno.remove(revisionRoot, { recursive: true });
  }
});

Deno.test("loadRevisions requires rationale for suppress revisions", async () => {
  const revisionRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-revisions-load-suppress-bad-",
  });

  await Deno.writeTextFile(
    join(revisionRoot, "suppress-without-rationale.json"),
    JSON.stringify({
      id: "suppress-bad",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.board:shadow",
      patch: { suppress: true },
    }),
  );

  try {
    await assertRejects(
      () => loadRevisions(revisionRoot),
      Error,
      "suppress revisions require rationale",
    );
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
