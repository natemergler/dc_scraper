import { assertEquals } from "@std/assert";
import { buildKnownEntityRef } from "../src/v2/connectors/shared.ts";
import { buildEntityId } from "../src/v2/domain.ts";

Deno.test("known relationship endpoint aliases resolve to accepted-style entity ids", () => {
  assertEquals(
    buildKnownEntityRef("Alcoholic Beverages and Cannabis Administration (ABCA)"),
    "dc.alcoholic_beverage_and_cannabis_administration",
  );
  assertEquals(buildKnownEntityRef("Mayor"), "dc.mayor");
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Veterans Affairs (MOVA)"),
    "dc.mayor_s_office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of General Counsel"),
    "dc.mayor_s_office_of_legal_counsel",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of the General Counsel"),
    "dc.mayor_s_office_of_legal_counsel",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Veteran's Affairs"),
    "dc.mayor_s_office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Office of Veterans Affairs"),
    "dc.mayor_s_office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Licensing and Consumer Protection"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(
    buildKnownEntityRef("Department of Health (DOH)"),
    "dc.dc_health",
  );
  assertEquals(
    buildKnownEntityRef("Department of Housing and Community Development (DHCD)"),
    "dc.department_of_housing_and_community_development",
  );
  assertEquals(buildKnownEntityRef("City Administrator"), "dc.office_of_the_city_administrator");
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)"),
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  );
  assertEquals(buildKnownEntityRef("District of Columbia Auditor"), "dc.office_of_the_dc_auditor");
  assertEquals(
    buildKnownEntityRef("District of Columbia Board of Elections"),
    "dc.board_of_elections",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Housing Authority"),
    "dc.dc_housing_authority",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Public Library System"),
    "dc.dc_public_library",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Water and Sewer Authority"),
    "dc.dc_water",
  );
  assertEquals(buildKnownEntityRef("Water and Sewer Authority (WASA)"), "dc.dc_water");
  assertEquals(
    buildKnownEntityRef("Fire and Emergency Medical Services Department"),
    "dc.fire_and_emergency_medical_services",
  );
  assertEquals(
    buildKnownEntityRef("Department of Energy and the Environment (DOEE)"),
    "dc.department_of_energy_and_environment",
  );
  assertEquals(buildKnownEntityRef("DOEE"), "dc.department_of_energy_and_environment");
  assertEquals(
    buildKnownEntityRef("DC Taxicab Commission (DCTC)"),
    "dc.district_of_columbia_taxicab_commission",
  );
  assertEquals(
    buildKnownEntityRef("Department of Forensic Sciences/DFS"),
    "dc.department_of_forensic_sciences",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Attorney General for the District of Columbia"),
    "dc.office_of_the_attorney_general",
  );
  assertEquals(buildKnownEntityRef("EOM"), "dc.executive_office_of_the_mayor");
  assertEquals(
    buildKnownEntityRef("Executive Office of the Senior Advisor"),
    "dc.office_of_the_senior_advisor",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Secretary of the District of Columbia"),
    "dc.office_of_the_secretary",
  );
  assertEquals(
    buildKnownEntityRef("Office of Victim Services and Justice Grants/OVSJG"),
    "dc.office_of_victim_services_and_justice_grants",
  );
  assertEquals(buildKnownEntityRef("DC Court of Appeals"), "dc.court_of_appeals");
  assertEquals(buildKnownEntityRef("DC Superior Court"), "dc.superior_court");
  assertEquals(
    buildKnownEntityRef("Office of the People’s Counsel"),
    "dc.office_of_the_people_s_counsel_for_the_district_of_columbia",
  );
  assertEquals(
    buildKnownEntityRef(
      "Mayor's Office of Lesbian, Gay, Bisexual, Transgender and Questioning Affairs (LGBTQ) Affairs",
    ),
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  );
  assertEquals(
    buildKnownEntityRef(
      "Mayor's Office of Lesbian, Gay, Bisexual, Transgender and Questioning Affairs Affairs",
    ),
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Office of Neighbor Safety and Engagement (ONSE)"),
    "dc.office_of_neighborhood_safety_and_engagement",
  );
  assertEquals(
    buildKnownEntityRef("Office of Neighbor Safety and Engagement"),
    "dc.office_of_neighborhood_safety_and_engagement",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Ombudsmen for Children (OFC)"),
    "dc.office_of_the_ombudsperson_for_children",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Ombudsmen for Children"),
    "dc.office_of_the_ombudsperson_for_children",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Human Resources (DCHR)"),
    "dc.department_of_human_resources",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Human Resources"),
    "dc.department_of_human_resources",
  );
  assertEquals(
    buildKnownEntityRef("DC Office of Zoning"),
    "dc.office_of_zoning",
  );
  assertEquals(
    buildKnownEntityRef("Department of Youth Rehabilitative Services"),
    "dc.department_of_youth_rehabilitation_services",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Committee on Child Abuse and Neglect"),
    "dc.mayor_s_advisory_committee_on_child_abuse_and_neglect",
  );
  assertEquals(
    buildKnownEntityRef("Chief Medical Examiner (CME)"),
    "dc.office_of_the_chief_medical_examiner",
  );
  assertEquals(
    buildKnownEntityRef("Chief Medical Examiner"),
    "dc.office_of_the_chief_medical_examiner",
  );
  assertEquals(
    buildKnownEntityRef("Chief Technology Officer"),
    "dc.office_of_the_chief_technology_officer",
  );
  assertEquals(
    buildKnownEntityRef("Bicycle Advisory Council"),
    "dc.bicycle_advisory_council",
  );
  assertEquals(
    buildKnownEntityRef("Board of Barber and Cosmetology"),
    "dc.board_of_barber_and_cosmetology",
  );
  assertEquals(
    buildKnownEntityRef("Board of Architecture, Interior Design and Landscape Architect"),
    "dc.board_of_architecture_interior_design_and_landscape_architecture",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Aging"),
    "dc.commission_on_aging",
  );
  assertEquals(
    buildKnownEntityRef("Health Information Exchange Policy Board"),
    "dc.health_information_exchange_policy_board_hie",
  );
  assertEquals(
    buildKnownEntityRef("Board of Review of Anti-Deficiency Violations"),
    "dc.board_of_review_for_anti_deficiency_violations",
  );
  assertEquals(
    buildKnownEntityRef("Citizen Review Panel on Child Abuse and Neglect"),
    "dc.citizen_review_panel_for_child_abuse_and_neglect",
  );
  assertEquals(
    buildKnownEntityRef("Sentencing Commission"),
    "dc.district_of_columbia_sentencing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Nightlife and Culture"),
    "dc.commission_on_nightlife_and_culture",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Women"),
    "dc.commission_for_women",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Sentencing Commission"),
    "dc.district_of_columbia_sentencing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Destination DC"),
    "dc.washington_d_c_convention_and_tourism_corporation",
  );
  assertEquals(
    buildKnownEntityRef("Department of Consumer and Regulatory Affairs"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Planning and Economic Development (DMPED)"),
    "dc.office_of_the_deputy_mayor_for_planning_and_economic_development",
  );
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)"),
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  );
  assertEquals(
    buildKnownEntityRef("Inspector General"),
    "dc.office_of_the_inspector_general",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Asian and Pacific Islander Affairs"),
    "dc.mayor_s_office_on_asian_and_pacific_island_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Asian and Pacific Islander Affairs (MOAPIA)"),
    "dc.mayor_s_office_on_asian_and_pacific_island_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of African Affairs"),
    "dc.mayor_s_office_on_african_affairs",
  );
  assertEquals(
    buildKnownEntityRef(
      "Mayor's Office of Lesbian, Gay, Bisexual and Questioning Affairs (LGBTQA)",
    ),
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Women's Policy Initiatives (MOWPI)"),
    "dc.mayor_s_office_on_women_s_policy_and_initiatives",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Returning Citizen's Affairs (MORCA)"),
    "dc.mayor_s_office_on_returning_citizen_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Religious Affairs (MORA)"),
    "dc.mayor_s_office_of_religious_affairs",
  );
  assertEquals(
    buildKnownEntityRef("MODDHH"),
    "dc.office_for_the_deaf_deafblind_and_hard_of_hearing",
  );
  assertEquals(buildKnownEntityRef("MOPI"), "dc.mayor_s_office_of_policy_and_innovation");
  assertEquals(
    buildKnownEntityRef("MPD"),
    "dc.metropolitan_police_department",
  );
  assertEquals(
    buildKnownEntityRef("Office on Returning Citizen Affairs"),
    "dc.mayor_s_office_on_returning_citizen_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Office of City Administrator"),
    "dc.office_of_the_city_administrator",
  );
  assertEquals(
    buildKnownEntityRef("Office of Religious Affairs"),
    "dc.mayor_s_office_of_religious_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Public Charter School Board (PCSB)"),
    "dc.public_charter_school_board_pcsb",
  );
  assertEquals(
    buildKnownEntityRef("DC Public Charter School Board"),
    "dc.public_charter_school_board_pcsb",
  );
  assertEquals(
    buildKnownEntityRef("Rental Housing Commission"),
    "dc.rental_housing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Secretary of State of the District of Columbia"),
    "dc.office_of_the_secretary",
  );
  assertEquals(
    buildKnownEntityRef("Office on Caribbean Community Affairs"),
    "dc.office_on_caribbean_affairs",
  );
  assertEquals(buildKnownEntityRef("CCRC"), "dc.criminal_code_reform_commission");
  assertEquals(buildKnownEntityRef("SBOE"), "dc.dc_state_board_of_education");
  assertEquals(
    buildKnownEntityRef("State Superintendent of Education"),
    "dc.office_of_the_state_superintendent_of_education",
  );
});

Deno.test("known relationship endpoint aliases keep role and subunit labels as candidates", () => {
  for (
    const name of [
      "UDC Community College",
      "Chief Information Security Officer (CISO) Designee",
      "Department on Disability Services (DDS) Vocational Rehabilitation Counselor Designee",
      "Hospital in the District Designee",
      "Vocational, Community, or Business Organization Representative designee",
      "Director of the Office of Budget and Performance Management (OBPM) Designee",
      "Office of the Chief of Staff (COS) Designee",
      "DC ReEngagement Center Designee",
      "Senior Advisor to the Mayor designee",
    ]
  ) {
    assertEquals(buildKnownEntityRef(name), buildEntityId(name));
  }
});
