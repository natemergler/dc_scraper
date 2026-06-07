import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  dcgisBoardsBinding,
  dcgisBoardsSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_boards.ts";
import { interpretDcgisBoards } from "../../../src/jurisdictions/dc/interpreters/dcgis_boards.ts";

Deno.test("dcgis.boards records become board entries and relation", () => {
  const output = interpretDcgisBoards([{
    source: dcgisBoardsSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: {
      BOARD_ID: "b-1",
      BOARD_NAME: "Advisory Board",
      SHORT_NAME: "AB",
      AGENCY_ID: "a-1",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.findings, []);

  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.fragmentType, "entry");
  assertEquals(entryFragment.source, dcgisBoardsSource.id);
  assertEquals(entryFragment.sourceRecordId, "row-1");
  assertEquals(entryFragment.provisionalId, "dc.board:b-1");
  assertEquals(entryFragment.kind, "dc.board");
  assertEquals(entryFragment.name, "Advisory Board");
  assertEquals(entryFragment.citations, [cite(dcgisBoardsSource.id, "row-1")]);
  assertEquals(entryFragment.attributes.shortName, "AB");
  assertEquals(entryFragment.attributes.sourceBoardId, "b-1");

  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.fragmentType, "relation");
  assertEquals(relationFragment.from, "dc.board:b-1");
  assertEquals(relationFragment.to, "dc.agency:a-1");
  assertEquals(relationFragment.relationKind, "dc.relation:governs");
  assertEquals(relationFragment.citations, [cite(dcgisBoardsSource.id, "row-1")]);
});

Deno.test("dcgis.boards reports warning when name is missing", () => {
  const output = interpretDcgisBoards([{
    source: dcgisBoardsSource.id,
    snapshotKey: "page-0",
    key: "row-2",
    payload: {
      BOARD_ID: "b-2",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.board_name_missing");
  assertEquals(output.findings[0].citation, cite(dcgisBoardsSource.id, "row-2"));
});

Deno.test("dcgis.boards reports warning for invalid record payload", () => {
  const output = interpretDcgisBoards([{
    source: dcgisBoardsSource.id,
    snapshotKey: "page-0",
    key: "row-3",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("dcgis.boards resolves governing agency by name from context", () => {
  const context = {
    agencyLookup: new Map([
      ["department of public works", "a-1"],
      ["dpw", "a-2"],
    ]),
  };

  const output = interpretDcgisBoards([{
    source: dcgisBoardsSource.id,
    snapshotKey: "page-0",
    key: "row-4",
    payload: {
      ENTITY_ID: "b-1",
      NAME: "District Board",
      GOVERNING_AGENCY: "Department Of Public Works",
      SHORT_NAME: "DB",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);

  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-1");
});

Deno.test("dcgis.boards resolves governing agency label with abbreviation variants", () => {
  const context = {
    agencyLookup: new Map([
      ["department of public works", "a-1"],
    ]),
  };

  const output = interpretDcgisBoards([{
    source: dcgisBoardsSource.id,
    snapshotKey: "page-0",
    key: "row-5",
    payload: {
      ENTITY_ID: "b-2",
      NAME: "District Board",
      GOVERNING_AGENCY: "Dept. of Public Works",
      SHORT_NAME: "DB",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);

  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-1");
});

Deno.test("dcgis.boards source binding links interpreter", () => {
  assertEquals(dcgisBoardsBinding.source.id, dcgisBoardsSource.id);
  assertEquals(dcgisBoardsBinding.interpret, interpretDcgisBoards);
});
