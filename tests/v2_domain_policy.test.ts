import { assertEquals } from "@std/assert";
import { inverseRelationshipType, parseLegalReference } from "../src/v2/domain.ts";

Deno.test("legal reference parsing normalizes common DC citation families", () => {
  assertEquals(
    parseLegalReference("D.C. Official Code § 1-204.22").normalizedCitation,
    "D.C. Code 1-204.22",
  );
  assertEquals(parseLegalReference("24 DCMR § 100.1").normalizedCitation, "24 DCMR 100.1");
  assertEquals(
    parseLegalReference("Mayor’s Order 2024-001").normalizedCitation,
    "Mayor's Order 2024-001",
  );
  assertEquals(
    parseLegalReference("Mayor's Order 2001-92 Amended 2002-142", "https://code.dccouncil.us/")
      .refType,
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("Mayor’s Order 83-25 (January 2, 1983)").normalizedCitation,
    "Mayor's Order 83-25",
  );
  assertEquals(
    parseLegalReference("Mayor's Orders 2017-314").normalizedCitation,
    "Mayor's Order 2017-314",
  );
  assertEquals(parseLegalReference("Mayor's Order 20012-49"), {
    refType: "unknown",
    citationText: "Mayor's Order 20012-49",
    normalizedCitation: undefined,
    needsReview: true,
  });
  assertEquals(
    parseLegalReference("71 D.C. Register 012345").normalizedCitation,
    "71 D.C. Register 012345",
  );
  assertEquals(
    parseLegalReference("District of Columbia Official Code").normalizedCitation,
    "D.C. Official Code",
  );
  assertEquals(
    parseLegalReference("Mayor's Orders", "https://dcregs.dc.gov/default.aspx").refType,
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("Mayor's Orders", "https://mayor.dc.gov/page/mayors-orders").refType,
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("DC Municipal Regulations and DC Register", "https://www.dcregs.dc.gov/")
      .normalizedCitation,
    "DCMR and D.C. Register",
  );
  assertEquals(
    parseLegalReference(
      "Climate Commitment Amendment Act of 2022",
      "https://code.dccouncil.gov/us/dc/council/laws/24-176",
    ),
    {
      refType: "dc_law",
      citationText: "Climate Commitment Amendment Act of 2022",
      normalizedCitation: "D.C. Law 24-176",
      needsReview: false,
    },
  );
  assertEquals(
    parseLegalReference(
      "Office of District Waterways Management Establishment Act of 2022",
      "https://code.dccouncil.gov/us/dc/council/laws/24-336",
    ),
    {
      refType: "dc_law",
      citationText: "Office of District Waterways Management Establishment Act of 2022",
      normalizedCitation: "D.C. Law 24-336",
      needsReview: false,
    },
  );
  assertEquals(parseLegalReference("§ 25–202").normalizedCitation, "D.C. Code 25-202");
  assertEquals(parseLegalReference("4-1303.01a").normalizedCitation, "D.C. Code 4-1303.01a");
  assertEquals(parseLegalReference("1993-148"), {
    refType: "unknown",
    citationText: "1993-148",
    normalizedCitation: undefined,
    needsReview: true,
  });
  assertEquals(
    parseLegalReference("D.C. Official Code § 47-2853.06(b)(1)").normalizedCitation,
    "D.C. Code 47-2853.06(b)(1)",
  );
  assertEquals(parseLegalReference("D.C. Law 22-155").refType, "dc_law");
  assertEquals(parseLegalReference("D.C. Law 22-155").normalizedCitation, "D.C. Law 22-155");
  assertEquals(parseLegalReference("MO 2016-083").normalizedCitation, "Mayor's Order 2016-083");
  assertEquals(parseLegalReference("33 U.S. Code § 1267").refType, "us_code");
  assertEquals(parseLegalReference("33 U.S. Code § 1267").normalizedCitation, "33 U.S.C. § 1267");
  assertEquals(
    parseLegalReference(
      "1993-148; amended by 2001-79 and 2012-154",
      "https://www.open-dc.gov/Mayors_Order_2012-154",
    ).normalizedCitation,
    "Mayor's Order 1993-148; amended by 2001-79 and 2012-154",
  );
  assertEquals(
    parseLegalReference("D.C. Law 22-228. Boxing and Wrestling Commission Amendment Act of 2018")
      .normalizedCitation,
    "D.C. Law 22-228",
  );
  assertEquals(parseLegalReference("REACH Act (D.C. Act 23-521)").refType, "dc_act");
  assertEquals(
    parseLegalReference("REACH Act (D.C. Act 23-521)").normalizedCitation,
    "D.C. Act 23-521",
  );
  assertEquals(parseLegalReference("Public Law 89-774").refType, "public_law");
  assertEquals(parseLegalReference("Public Law 89-774").normalizedCitation, "Public Law 89-774");
  assertEquals(parseLegalReference("B21-0697").refType, "dc_bill");
  assertEquals(parseLegalReference("B21-0697").normalizedCitation, "D.C. Bill B21-0697");
  assertEquals(parseLegalReference("Act B20-0366").refType, "dc_bill");
  assertEquals(parseLegalReference("Act B20-0366").normalizedCitation, "D.C. Bill B20-0366");
  assertEquals(
    parseLegalReference("DC ST D.I, T. 1, Ch.15, Subch. XIV, Pt. A, 1996 Plan 4")
      .normalizedCitation,
    "Reorganization Plan No. 4 of 1996",
  );
  assertEquals(
    parseLegalReference(
      "DC. ST. D.I., T.1, Ch 15, Subch. III, Pt. 1, 1979 Plan 2 (IV. B. (2)); 5-1402 et seq.",
    )
      .refType,
    "unknown",
  );
});

Deno.test("public-body seat relationship inverses stay user-facing", () => {
  assertEquals(inverseRelationshipType("has_seat"), "seat_on");
  assertEquals(inverseRelationshipType("has_status"), "status_of");
  assertEquals(inverseRelationshipType("designated_by"), "designates");
});
