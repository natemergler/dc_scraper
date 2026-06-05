import { assert, assertEquals } from "@std/assert";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { quickbaseAppointmentsCsvFixture, quickbaseFixture } from "./helpers/v2_fixtures.ts";

async function runQuickbaseConnector(appointmentsCsv: string) {
  return await getConnector("mota.quickbase").run(
    createConnectorContext({
      fetcher: async (url: string) => {
        const body = (() => {
          switch (url) {
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
              return quickbaseFixture;
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
              return appointmentsCsv;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        })();
        return {
          status: 200,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T,
        };
      },
    }),
  );
}

Deno.test(
  "quickbase connector parses public CSV appointment rows into seats, statuses, authorities, and appointee observations",
  async () => {
    const appointmentsCsvWithAlias = `${quickbaseAppointmentsCsvFixture.trim()}
"Commission on Nightlife and Culture (CNC)","Alcoholic Beverages and Cannabis Administration (ABCA) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
"Mayor's Advisory Committee on Child Abuse and Neglect (MACCAN)","Office of the State Superintendent of Education (OSSE) Designee Office of the State Superintendent of Education (OSSE) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`;
    const result = await runQuickbaseConnector(appointmentsCsvWithAlias);
    assertEquals(result.endpointResults.length, 2);
    assertEquals(result.endpointResults[1].status, "success");
    const parsed = result.endpointResults[1].parsed;
    assert(parsed);
    assertEquals(parsed.items?.length, 7);
    assert(
      parsed.entityCandidates?.some((candidate) =>
        candidate.name === "Downtown Revitalization Committee"
      ),
    );
    const boardCandidate = parsed.entityCandidates?.find((candidate) =>
      candidate.name === "Downtown Revitalization Committee"
    );
    assert(
      parsed.entityCandidates?.some((candidate) =>
        candidate.name === "District of Columbia Rental Housing Commission"
      ),
    );
    const seatCandidate = parsed.entityCandidates?.find((candidate) =>
      candidate.kind === "seat" && candidate.name ===
        "District of Columbia Rental Housing Commission Chairperson"
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) => candidate.relationshipType === "has_seat"),
    );
    assert(
      parsed.entityCandidates?.some((candidate) =>
        candidate.kind === "seat" && candidate.name ===
          "District of Columbia Rental Housing Commission Chairperson"
      ),
    );
    assert(
      parsed.entityCandidates?.some((candidate) =>
        candidate.kind === "seat" && candidate.name ===
          "Mayor's Advisory Committee on Child Abuse and Neglect (MACCAN) Office of the State Superintendent of Education Designee"
      ),
    );
    assertEquals(
      parsed.entityCandidates?.some((candidate) =>
        candidate.kind === "seat" &&
        candidate.name.includes(
          "Office of the State Superintendent of Education Designee Office of the State Superintendent of Education Designee",
        )
      ),
      false,
    );
    assertEquals(boardCandidate?.officialUrl, undefined);
    assertEquals(seatCandidate?.officialUrl, undefined);
    assert(
      parsed.entityCandidates?.some((candidate) =>
        candidate.kind === "appointment_status" && candidate.name === "Filled"
      ),
    );
    assert(
      parsed.entityCandidates?.some((candidate) =>
        candidate.kind === "appointee_observation" && candidate.name === "Jane Doe"
      ),
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "has_seat" &&
        candidate.fromEntityRef === "dc.district_of_columbia_rental_housing_commission" &&
        candidate.toEntityRef === "dc.district_of_columbia_rental_housing_commission_chairperson"
      ),
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "has_status" &&
        candidate.fromEntityRef ===
          "dc.district_of_columbia_rental_housing_commission_chairperson" &&
        candidate.toEntityRef === "status.filled"
      ),
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "holds" &&
        candidate.toEntityRef === "dc.district_of_columbia_rental_housing_commission_chairperson"
      ),
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "has_status" &&
        candidate.fromEntityRef.startsWith("observation.") &&
        candidate.toEntityRef === "status.filled"
      ),
    );
    assertEquals(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "overseen_by"
      ),
      false,
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "designated_by" &&
        candidate.rawValue === "Alcoholic Beverages and Cannabis Administration (ABCA) Designee" &&
        candidate.toEntityRef === "dc.alcoholic_beverage_and_cannabis_administration"
      ),
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "appointed_by" &&
        candidate.rawValue === "Mayoral Appointee" &&
        candidate.toEntityRef === "dc.mayor"
      ),
    );
    assert(
      parsed.relationshipCandidates?.some((candidate) =>
        candidate.relationshipType === "has_seat" &&
        candidate.rawValue ===
          "Office of the State Superintendent of Education (OSSE) Designee Office of the State Superintendent of Education (OSSE) Designee"
      ),
    );
    assert(
      parsed.reviewItems?.some((item) =>
        item.reason ===
          "Review appointing or designating authority inferred from Quickbase appointment row"
      ),
    );
    assert(
      parsed.reviewItems?.some((item) =>
        item.reason === "Review seat status from Quickbase appointment row"
      ),
    );
    assert(
      parsed.reviewItems?.some((item) =>
        item.reason === "Review public appointee observation from Quickbase appointment row"
      ),
    );
    assert(
      parsed.reviewItems?.some((item) => item.itemType === "relationship_candidate"),
    );
    assert(
      parsed.reviewItems?.every((item) => item.itemType !== "source_status"),
    );
    assert(
      parsed.datasets?.some((dataset) =>
        dataset.category === "appointments" &&
        dataset.officialUrl ===
          "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs"
      ),
    );
  },
);

Deno.test("quickbase connector dedupes exact duplicate appointee observations at source time", async () => {
  const duplicateRowsCsv = `
"Prefix","First Name","Last Name","Suffix","Appointment","BOARD OR COMMISSION - B or C","Seat Designation (specific role)","Appointment Status","Appointee Designation","Appointment Date","Commission Email Address"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
`.trim();
  const result = await runQuickbaseConnector(duplicateRowsCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 2);
  assertEquals(
    (parsed.entityCandidates ?? []).filter((candidate) =>
      candidate.kind === "appointee_observation" && candidate.name === "Jane Doe"
    ).length,
    1,
  );
  assertEquals(
    (parsed.relationshipCandidates ?? []).filter((candidate) =>
      candidate.relationshipType === "holds" &&
      candidate.toEntityRef ===
        "dc.board_of_ethics_and_government_accountability_bega_public_member"
    ).length,
    1,
  );
});

Deno.test("quickbase connector collapses blank and filled appointment dates into one observation", async () => {
  const dateMixedRowsCsv = `
"Prefix","First Name","Last Name","Suffix","Appointment","BOARD OR COMMISSION - B or C","Seat Designation (specific role)","Appointment Status","Appointee Designation","Appointment Date","Commission Email Address"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","","jane.doe@dc.gov"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
`.trim();
  const result = await runQuickbaseConnector(dateMixedRowsCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 2);
  assertEquals(
    (parsed.entityCandidates ?? []).filter((candidate) =>
      candidate.kind === "appointee_observation" && candidate.name === "Jane Doe"
    ).length,
    1,
  );
  assertEquals(
    (parsed.relationshipCandidates ?? []).filter((candidate) =>
      candidate.relationshipType === "holds" &&
      candidate.toEntityRef ===
        "dc.board_of_ethics_and_government_accountability_bega_public_member"
    ).length,
    1,
  );
});

Deno.test("quickbase connector keeps different non-empty appointment dates distinct", async () => {
  const dateDistinctRowsCsv = `
"Prefix","First Name","Last Name","Suffix","Appointment","BOARD OR COMMISSION - B or C","Seat Designation (specific role)","Appointment Status","Appointee Designation","Appointment Date","Commission Email Address"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","03-01-2020","jane.doe@dc.gov"
`.trim();
  const result = await runQuickbaseConnector(dateDistinctRowsCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 2);
  assertEquals(
    (parsed.entityCandidates ?? []).filter((candidate) =>
      candidate.kind === "appointee_observation" && candidate.name === "Jane Doe"
    ).length,
    2,
  );
  assertEquals(
    (parsed.relationshipCandidates ?? []).filter((candidate) =>
      candidate.relationshipType === "holds" &&
      candidate.toEntityRef ===
        "dc.board_of_ethics_and_government_accountability_bega_public_member"
    ).length,
    2,
  );
});

Deno.test("quickbase connector keeps non-identical appointee observations distinct", async () => {
  const changedRowsCsv = `
"Prefix","First Name","Last Name","Suffix","Appointment","BOARD OR COMMISSION - B or C","Seat Designation (specific role)","Appointment Status","Appointee Designation","Appointment Date","Commission Email Address"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Holdover","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
"","Jane","Doe","","New Appointment","Board of Ethics and Government Accountability (BEGA)","Agency Representative","Filled","Mayoral Appointee","02-16-2016","jane.doe@dc.gov"
"","Jane","Doe","","Reappointment","Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Mayoral Appointee","03-01-2020","jane.doe@dc.gov"
`.trim();
  const result = await runQuickbaseConnector(changedRowsCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 4);
  assertEquals(
    (parsed.entityCandidates ?? []).filter((candidate) =>
      candidate.kind === "appointee_observation" && candidate.name === "Jane Doe"
    ).length,
    4,
  );
  assertEquals(
    (parsed.relationshipCandidates ?? []).filter((candidate) =>
      candidate.relationshipType === "holds" &&
      candidate.fromEntityRef.startsWith("observation.") &&
      candidate.fromEntityRef.includes("jane_doe")
    ).length,
    4,
  );
});

Deno.test("Quickbase board labels resolve through accepted-style entity refs", async () => {
  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Board of Ethics and Government Accountability (BEGA)","Public Member","Filled","Jane Doe","Active"
`.trim();
  const result = await runQuickbaseConnector(csv);

  const parsed = result.endpointResults[1].parsed;
  const boardCandidate = parsed?.entityCandidates?.find((candidate) =>
    candidate.candidateId ===
      "candidate.mota.quickbase.board_of_ethics_and_government_accountability_bega"
  );
  const seatRelationship = parsed?.relationshipCandidates?.find((candidate) =>
    candidate.relationshipType === "has_seat"
  );

  assertEquals(
    boardCandidate?.proposedEntityId,
    "dc.board_of_ethics_and_government_accountability",
  );
  assertEquals(boardCandidate?.kind, "public_body");
  assertEquals(boardCandidate?.rawKind, "appointment_body");
  assertEquals(
    seatRelationship?.fromEntityRef,
    "dc.board_of_ethics_and_government_accountability",
  );
});

Deno.test("quickbase connector derives public appointee observations from live-style name columns", async () => {
  const liveStyleCsv = `
"Prefix","First Name","Last Name","Suffix","Appointment","BOARD OR COMMISSION - B or C","Seat Designation (specific role)","Appointment Status","Appointee Designation","Appointment Date","Commission Email Address"
"Dr.","Antoinette","Mitchell","","New Appointment","Adult Career Pathways Task Force","Office of the State Superintendent of Education (OSSE) Designee","Active / filled seat","Mayoral Appointee, DC Agency Representative","02-16-2016","antoinette.mitchell@dc.gov"
`;
  const result = await runQuickbaseConnector(liveStyleCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.kind === "appointee_observation" && candidate.name === "Dr. Antoinette Mitchell"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "holds" &&
      candidate.fromEntityRef.startsWith("observation.") &&
      candidate.fromEntityRef.includes("dr_antoinette_mitchell") &&
      candidate.toEntityRef ===
        "dc.adult_career_pathways_task_force_office_of_the_state_superintendent_of_education_designee"
    ),
  );
  const publicFacts = JSON.stringify({
    entityCandidates: parsed.entityCandidates,
    relationshipCandidates: parsed.relationshipCandidates,
    reviewItems: parsed.reviewItems,
  });
  assert(!publicFacts.includes("antoinette.mitchell@dc.gov"));
});

Deno.test("quickbase connector does not infer Council oversight from committee-like board names", async () => {
  const executiveAnchoredCsv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Advisory Committee to the Office of Administrative Hearings (OAH)","Member","Filled","Mayoral Appointee","Active"
"Mayor's Advisory Committee on Child Abuse and Neglect (MACCAN)","Member","Filled","Mayoral Appointee","Active"
"Public Space Committee (PSC)","Member","Filled","Mayoral Appointee","Active"
`;
  const result = await runQuickbaseConnector(executiveAnchoredCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  const oversightCandidates = (parsed.relationshipCandidates ?? []).filter((candidate) =>
    candidate.relationshipType === "overseen_by"
  );

  assertEquals(oversightCandidates.length, 0);
});

Deno.test("quickbase connector keeps contact columns out of public fact candidates", async () => {
  const csvWithContactColumns = quickbaseAppointmentsCsvFixture.replace(
    '"board status"',
    '"board status","Email","Phone","Private Notes"',
  ).replaceAll(
    '"Active"',
    '"Active","not-for-release@example.com","202-555-0100","private contact metadata"',
  );
  const result = await runQuickbaseConnector(csvWithContactColumns);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  const publicFacts = JSON.stringify({
    entityCandidates: parsed.entityCandidates,
    relationshipCandidates: parsed.relationshipCandidates,
    datasets: parsed.datasets,
    reviewItems: parsed.reviewItems,
  });
  assert(!publicFacts.includes("not-for-release@example.com"));
  assert(!publicFacts.includes("202-555-0100"));
  assert(!publicFacts.includes("private contact metadata"));
});

Deno.test("quickbase connector keeps source typos and role punctuation out of canonical names", async () => {
  const liveStyleCsv = `
"Prefix","First Name","Last Name","Suffix","Appointment","BOARD OR COMMISSION - B or C","Seat Designation (specific role)","Appointment Status","Appointee Designation","Appointment Date","Commission Email Address"
"x","Berta","Mata","","Reappointment","State Rehabilitation Council (SRC)","Representative of a disability advocacy group representing a cross section of individuals with physical, cognitive, sensory, and mental disabilities","Active / filled seat","Mayoral Appointee, Public Member","11-28-2018",""
"","Sandra","Mattavous-Frye","","Reappointment","Sustainable Energy Utility Advisory Board (SEU)","The People's Counsel deisgnee","Active / filled seat","Mayoral Appointee, DC Agency Representative","01-01-2026","sandra.mattavous-frye@dc.gov"
"","Shyra","Dowling","","Reappointment","Juvenile Justice Advisory Group (JJAG)","DCPS--Representatives from law enforcement and juvenile justice agencies, including juvenile and family court judges, prosecutors, counsel for children and youth, and probation workers","Active / filled seat","Mayoral Appointee, DC Agency Representative","06-20-2014","shyra.gregory@dcbc.dc.gov"
"","Japer","Bowles","","New Appointment","Advisory Committee to the Office of Lesbian, Gay, Bisexual, Transgender, and Questioning Affairs (LGBTQ)","Mayor's Office of Lesbian, Gay, Bisexual, Transgender and Questioning Affairs (LGBTQ) Affairs Designee","Active / filled seat","Mayoral Appointee, DC Agency Representative","",""
"","Sarah","Fashbaugh","","New Appointment","Commission on Nightlife and Culture (CNC)","Alcoholic Beverages and Cannabis Administration (ABCA) Designee","Active / filled seat","Mayoral Appointee, DC Agency Representative","",""
`;
  const result = await runQuickbaseConnector(liveStyleCsv);

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  const entityNames = (parsed.entityCandidates ?? []).map((candidate) => candidate.name);
  assert(entityNames.includes("Berta Mata"));
  assertEquals(entityNames.some((name) => name.includes("x Berta Mata")), false);
  assertEquals(entityNames.some((name) => name.includes("deisgnee")), false);
  assertEquals(entityNames.some((name) => name.includes("--")), false);
  assertEquals(entityNames.some((name) => name.includes("Affairs Affairs")), false);
  assertEquals(
    entityNames.some((name) => name.includes("Alcoholic Beverages and Cannabis Administration")),
    false,
  );
  assert(
    entityNames.some((name) =>
      name.includes("Sustainable Energy Utility Advisory Board") &&
      name.includes("The People's Counsel Designee")
    ),
  );
  assert(
    entityNames.some((name) =>
      name.includes("Juvenile Justice Advisory Group") &&
      name.includes("DCPS Representatives")
    ),
  );
  assert(
    (parsed.relationshipCandidates ?? []).some((candidate) =>
      candidate.rawValue === "The People's Counsel deisgnee"
    ),
  );
  assert(
    (parsed.relationshipCandidates ?? []).some((candidate) =>
      candidate.rawValue?.includes("DCPS--Representatives")
    ),
  );
  assert(
    (parsed.relationshipCandidates ?? []).some((candidate) =>
      candidate.rawValue === "Alcoholic Beverages and Cannabis Administration (ABCA) Designee"
    ),
  );
});

Deno.test("quickbase designee authority parsing normalizes trusted seats and skips unsupported role/category seats", async () => {
  const parserResidueSeats = [
    "Chief Information Security Officer (CISO) Designee",
    "Senior Advisor to the Mayor designee",
    "Hospital in the District Designee",
    "Higher Education Representative (University of the District of Columbia) designee",
    "Vocational, Community, or Business Organization Representative designee",
    "Metropolitan Police Department Reserve Corps designee",
  ];
  const parentAgencySubunitSeats = [
    {
      seat:
        "Department on Disability Services (DDS) Administrator of the Vocational Rehabilitation Agency Designee",
      parent: "dc.department_on_disability_services",
    },
    {
      seat:
        "Department on Disability Services (DDS) Rehabilitation Services Administration Representative Designee",
      parent: "dc.department_on_disability_services",
    },
    {
      seat: "Department on Disability Services (DDS) Vocational Rehabilitation Counselor Designee",
      parent: "dc.department_on_disability_services",
    },
    {
      seat: "District Department of Transportation (DDOT) Operations Designee",
      parent: "dc.district_department_of_transportation",
    },
    {
      seat: "District Department of Transportation (DDOT) Policy & Planning Designee",
      parent: "dc.district_department_of_transportation",
    },
  ];
  const safeSourceBackedAuthoritySeats = [
    {
      seat: "University of the District of Columbia Community College (UDCCC) Designee",
      parent: "dc.university_of_the_district_of_columbia_community_college",
      name: "University of the District of Columbia Community College",
    },
    {
      seat: "Director of the Office of Budget and Performance Management (OBPM) Designee",
      parent: "dc.office_of_budget_and_performance_management",
      name: "Office of Budget and Performance Management",
    },
  ];
  const safeDesignatingOnlyAuthoritySeats = [
    {
      seat: "Office of the Chief of Staff (COS) Designee",
      parent: "dc.office_of_the_chief_of_staff",
      name: "Office of the Chief of Staff",
    },
  ];
  const explicitKnownAuthoritySeats = [
    {
      seat: "Mayor's Committee on Child Abuse and Neglect designee",
      parent: "dc.mayor_s_advisory_committee_on_child_abuse_and_neglect",
      name: "Mayor's Committee on Child Abuse and Neglect",
    },
  ];
  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Example Role Board","Director of the Department of Employment Services (DOES) Designee","Filled","Jane Doe","Active"
"Example Charter Board","Public Charter School Board (PCSB) Designee","Filled","Alex Doe","Active"
"Example Licensing Board","Department of Consumer and Regulatory Affairs (DCRA) Designee","Filled","Sam Doe","Active"
"Example Alternate Board","Department of Health (DOH) Alternate Designee","Filled","Taylor Doe","Active"
"Example Subunit Board","Department of Behavioral Health (DBH) - Addiction Prevention and Recovery Administration Designee","Filled","Robin Doe","Active"
"Example Chief Board","Chief of the Fire and Emergency Medical Services Department (FEMS) Designee","Filled","Morgan Doe","Active"
"Example Mayor Board","The Mayor's designee","Filled","Casey Doe","Active"
"Example Professional Board","Licensed Independent Clinical Social Worker (LICSW)","Filled","Pat Doe","Active"
  ${
    parserResidueSeats.map((seat, index) =>
      `"Example Residue Board ${index + 1}","${seat}","Filled","Residue Person ${
        index + 1
      }","Active"`
    ).join("\n")
  }
${
    parentAgencySubunitSeats.map(({ seat }, index) =>
      `"Example Parent Agency Board ${index + 1}","${seat}","Filled","Resolved Person ${
        index + 1
      }","Active"`
    ).join("\n")
  }
${
    safeSourceBackedAuthoritySeats.map(({ seat }, index) =>
      `"Example Source Backed Board ${
        index + 1
      }","${seat}","Filled","Mayoral Appointee, DC Agency Representative","Active"`
    ).join("\n")
  }
${
    safeDesignatingOnlyAuthoritySeats.map(({ seat }, index) =>
      `"Example Designating Only Board ${
        index + 1
      }","${seat}","Filled","Mayoral Appointee, DC Agency Representative","Active"`
    ).join("\n")
  }
${
    explicitKnownAuthoritySeats.map(({ seat }, index) =>
      `"Example Known Alias Board ${index + 1}","${seat}","Filled","Mayoral Appointee","Active"`
    ).join("\n")
  }
`.trim();
  const result = await runQuickbaseConnector(csv);

  const relationships = result.endpointResults[1].parsed?.relationshipCandidates ?? [];
  assertEquals(
    relationships.some((candidate) => candidate.relationshipType === "governed_by"),
    false,
    "Quickbase seat designations should not emit body-level governed_by relationships",
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue === "Director of the Department of Employment Services (DOES) Designee" &&
      candidate.toEntityRef === "dc.department_of_employment_services"
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue === "Public Charter School Board (PCSB) Designee" &&
      candidate.toEntityRef === "dc.public_charter_school_board_pcsb"
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue === "Department of Consumer and Regulatory Affairs (DCRA) Designee" &&
      candidate.toEntityRef === "dc.department_of_licensing_and_consumer_protection"
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue === "Department of Health (DOH) Alternate Designee" &&
      candidate.toEntityRef === "dc.dc_health"
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue ===
        "Department of Behavioral Health (DBH) - Addiction Prevention and Recovery Administration Designee" &&
      candidate.toEntityRef === "dc.department_of_behavioral_health"
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue ===
        "Chief of the Fire and Emergency Medical Services Department (FEMS) Designee" &&
      candidate.toEntityRef === "dc.fire_and_emergency_medical_services"
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.relationshipType === "designated_by" &&
      candidate.rawValue === "The Mayor's designee" &&
      candidate.toEntityRef === "dc.mayor"
    ),
  );
  assertEquals(
    relationships.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Licensed Independent Clinical Social Worker (LICSW)"
    ),
    false,
  );
  for (const seat of parserResidueSeats) {
    assertEquals(
      relationships.some((candidate) =>
        (candidate.relationshipType === "governed_by" ||
          candidate.relationshipType === "designated_by") &&
        candidate.rawValue === seat
      ),
      false,
      `${seat} should not emit governed_by/designated_by`,
    );
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "has_seat" && candidate.rawValue === seat
      ),
    );
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "holds" && candidate.rawValue === seat
      ),
    );
  }
  for (const { seat, parent } of parentAgencySubunitSeats) {
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "designated_by" &&
        candidate.rawValue === seat &&
        candidate.toEntityRef === parent
      ),
      `${seat} should emit designated_by ${parent}`,
    );
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "has_seat" && candidate.rawValue === seat
      ),
    );
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "holds" && candidate.rawValue === seat
      ),
    );
  }
  for (const { seat, parent, name } of safeSourceBackedAuthoritySeats) {
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "designated_by" &&
        candidate.rawValue === seat &&
        candidate.toEntityRef === parent &&
        candidate.toEntityName === name &&
        candidate.toEntitySafeToAutoAccept === true
      ),
      `${seat} should emit safe designated_by ${parent}`,
    );
  }
  for (const { seat, parent, name } of safeDesignatingOnlyAuthoritySeats) {
    assertEquals(
      relationships.some((candidate) =>
        candidate.relationshipType === "governed_by" &&
        candidate.rawValue === seat
      ),
      false,
      `${seat} should not emit governed_by`,
    );
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "designated_by" &&
        candidate.rawValue === seat &&
        candidate.toEntityRef === parent &&
        candidate.toEntityName === name &&
        candidate.toEntitySafeToAutoAccept === true
      ),
      `${seat} should emit safe designated_by ${parent}`,
    );
  }
  for (const { seat, parent, name } of explicitKnownAuthoritySeats) {
    assert(
      relationships.some((candidate) =>
        candidate.relationshipType === "designated_by" &&
        candidate.rawValue === seat &&
        candidate.toEntityRef === parent &&
        candidate.toEntityName === name &&
        candidate.toEntitySafeToAutoAccept === true
      ),
      `${seat} should emit safe designated_by ${parent}`,
    );
  }
});
