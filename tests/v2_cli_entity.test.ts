import { assertEquals, assertStringIncludes } from "@std/assert";
import { type EntityCommandDeps, handleEntityCommand } from "../src/v2/cli_entity.ts";

Deno.test("entity search json points results to entity inspection", async () => {
  const dbPath = "/tmp/entity-search.sqlite";
  const deps: EntityCommandDeps = {
    searchEntities: async () => [{
      entityId: "dc.board_of_accountancy",
      name: "Board of Accountancy",
      kind: "board",
      reviewStatus: "accepted",
    }],
    entityView: async () => {
      throw new Error("unused");
    },
  };

  const { result, stdout } = await captureConsole(async () =>
    await handleEntityCommand(
      ["entity", "search", "accountancy"],
      { dbPath, json: true },
      deps,
    )
  );
  const rows = JSON.parse(stdout[0]) as Array<{
    entityId: string;
    showCommand?: string;
  }>;

  assertEquals(result, true);
  assertEquals(rows[0].entityId, "dc.board_of_accountancy");
  assertEquals(
    rows[0].showCommand,
    `deno task dc -- entity show dc.board_of_accountancy --db ${dbPath}`,
  );
});

Deno.test("entity search text points results to entity inspection", async () => {
  const deps: EntityCommandDeps = {
    searchEntities: async () => [{
      entityId: "dc.board_of_accountancy",
      name: "Board of Accountancy",
      kind: "board",
      reviewStatus: "accepted",
    }],
    entityView: async () => {
      throw new Error("unused");
    },
  };

  const { result, stdout } = await captureConsole(async () =>
    await handleEntityCommand(["entity", "search", "accountancy"], {}, deps)
  );

  assertEquals(result, true);
  const output = stdout.join("\n");
  assertStringIncludes(output, "dc.board_of_accountancy Board of Accountancy [board] accepted");
  assertStringIncludes(output, "Show: deno task dc -- entity show dc.board_of_accountancy");
});

Deno.test("entity show text uses structured review commands", async () => {
  const dbPath = "/tmp/entity-show.sqlite";
  const reviewCommand =
    "deno task dc -- review relationships --source test.source --subject-prefix relationship.test.focused";
  const deps: EntityCommandDeps = {
    searchEntities: async () => {
      throw new Error("unused");
    },
    entityView: async () => ({
      entityId: "dc.office_of_testing",
      name: "Office of Testing",
      kind: "office",
      reviewStatus: "accepted",
      evidence: [],
      outgoing: [],
      incoming: [],
      legalRefs: [],
      reviewItems: [{
        reviewItemId: "review.relationship.test",
        itemType: "relationship_candidate",
        conflictKind: "fact_conflict",
        subjectKind: "relationship",
        subjectId: "relationship.test.focused",
        reviewCommand,
        reason: "needs_relationship_review",
        defaultAction: "defer",
        status: "open",
        proposedActions: [],
        details: {},
        subject: {
          sourceId: "test.source",
          relationshipType: "overseen_by",
          fromEntityRef: "dc.office_of_testing",
          toEntityRef: "dc.target",
        },
      }],
    }),
  };

  const { result, stdout } = await captureConsole(async () =>
    await handleEntityCommand(
      ["entity", "show", "dc.office_of_testing"],
      { dbPath },
      deps,
    )
  );

  assertEquals(result, true);
  assertStringIncludes(
    stdout.join("\n"),
    `review: ${reviewCommand} --db ${dbPath}`,
  );
  assertStringIncludes(
    stdout.join("\n"),
    `Next: ${reviewCommand} --db ${dbPath}`,
  );

  const { result: jsonResult, stdout: jsonStdout } = await captureConsole(async () =>
    await handleEntityCommand(
      ["entity", "show", "dc.office_of_testing"],
      { dbPath, json: true },
      deps,
    )
  );
  const body = JSON.parse(jsonStdout[0]) as {
    nextCommand?: string;
    reviewItems: Array<{ reviewCommand?: string }>;
  };
  assertEquals(jsonResult, true);
  assertEquals(body.reviewItems[0]?.reviewCommand, `${reviewCommand} --db ${dbPath}`);
  assertEquals(body.nextCommand, `${reviewCommand} --db ${dbPath}`);
});

function captureConsole<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string[] }> {
  const original = console.log;
  const stdout: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args.map((value) => String(value)).join(" "));
  };
  return fn().then((result) => ({ result, stdout })).finally(() => {
    console.log = original;
  });
}
