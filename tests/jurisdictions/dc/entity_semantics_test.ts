import { assertEquals } from "@std/assert";

import {
  dcEntityKindDescription,
  dcEntityKindSemantics,
  dcPublicNodeCategory,
  dcPublicNodeKinds,
} from "../../../src/jurisdictions/dc/kinds/entity.ts";
import { dcRuntime } from "../../../src/jurisdictions/dc/index.ts";

Deno.test("DC entity semantics describe every registered entry kind", () => {
  const registeredKinds = dcRuntime.kinds.listKinds().map((kind) => kind.kind).sort();
  const semanticKinds = dcEntityKindSemantics.map((semantics) => semantics.kind).sort();

  assertEquals(new Set(semanticKinds).size, semanticKinds.length);
  assertEquals(semanticKinds, registeredKinds);
  for (const kind of registeredKinds) {
    assertEquals(typeof dcEntityKindDescription(kind), "string");
  }
});

Deno.test("DC entity semantics keep public projection categories explicit", () => {
  assertEquals(dcPublicNodeCategory("dc.agency"), "executive");
  assertEquals(dcPublicNodeCategory("dc.committee"), "legislative");
  assertEquals(dcPublicNodeCategory("dc.board"), "public_body");
  assertEquals(dcPublicNodeCategory("dc.council"), "public_body");
  assertEquals(dcPublicNodeCategory("dc.anc_commissioner_seat"), "neighborhood");
  assertEquals(dcPublicNodeCategory("dc.court_division"), "judicial");
  assertEquals(dcPublicNodeCategory("dc.councilmember"), "representation");
  assertEquals(dcPublicNodeCategory("dc.legal_authority"), "legal_authority");
  assertEquals(dcPublicNodeCategory("dc.legal_source"), undefined);

  const publicKinds = dcPublicNodeKinds().sort();
  assertEquals(publicKinds.includes("dc.legal_source"), false);
  for (const kind of publicKinds) {
    assertEquals(typeof dcEntityKindDescription(kind), "string");
    assertEquals(typeof dcPublicNodeCategory(kind), "string");
  }
});
