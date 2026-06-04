import { assertEquals } from "@std/assert";
import { DcLawTitleIndex, looksLikeDcLawTitle } from "../src/v2/connectors/dc_law_index.ts";

Deno.test("D.C. law title index matches exact titles from recursive law-html metadata", () => {
  const index = DcLawTitleIndex.fromJson({
    t: "D.C. Law Library",
    p: "/",
    c: [{
      t: "Laws",
      p: "/dclaws/22/permanent/effective",
      c: [{
        t: "D.C. Law 22-155. Green Finance Authority Establishment Act of 2018.",
        p: "/us/dc/council/laws/22-155",
        sc: "D.C. Law 22-155",
      }],
    }],
  });

  assertEquals(
    index.matchTitle("District of Columbia Green Finance Authority Establishment Act of 2018"),
    {
      citation: "D.C. Law 22-155",
      title: "Green Finance Authority Establishment Act of 2018",
      url: "https://code.dccouncil.gov/us/dc/council/laws/22-155",
    },
  );
  assertEquals(index.matchTitle("Organizational ByLaws"), undefined);
});

Deno.test("D.C. law title index strips citation prefixes from heading titles", () => {
  const index = DcLawTitleIndex.fromJson([{
    citation: "D.C. Law 22-155",
    heading: "D.C. Law 22-155. Green Finance Authority Establishment Act of 2018.",
    path: "/us/dc/council/laws/22-155",
  }]);

  assertEquals(index.matchTitle("Green Finance Authority Establishment Act of 2018"), {
    citation: "D.C. Law 22-155",
    title: "Green Finance Authority Establishment Act of 2018",
    url: "https://code.dccouncil.gov/us/dc/council/laws/22-155",
  });
});

Deno.test("D.C. law title index leaves duplicate exact titles unresolved", () => {
  const index = DcLawTitleIndex.fromJson([
    {
      citation: "D.C. Law 22-155",
      heading: "Shared Establishment Act of 2018",
      path: "/us/dc/council/laws/22-155",
    },
    {
      citation: "D.C. Law 22-156",
      heading: "Shared Establishment Act of 2018",
      path: "/us/dc/council/laws/22-156",
    },
  ]);

  assertEquals(index.matchTitle("Shared Establishment Act of 2018"), undefined);
  assertEquals(
    index.matchTitle("District of Columbia Shared Establishment Act of 2018"),
    undefined,
  );
});

Deno.test("D.C. law title detection stays narrower than malformed act labels", () => {
  assertEquals(
    looksLikeDcLawTitle("District of Columbia Green Finance Authority Establishment Act of 2018"),
    true,
  );
  assertEquals(looksLikeDcLawTitle("D.G. AGT 21-679"), false);
  assertEquals(looksLikeDcLawTitle("D.C. Law 22-155"), false);
});
