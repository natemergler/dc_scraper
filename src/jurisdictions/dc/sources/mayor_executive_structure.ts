import { type MayorExecutiveStructureSource as MayorExecutiveStructureReaderSource } from "../../../readers/mayor_executive_structure.ts";
import { interpretMayorExecutiveStructure } from "../interpreters/mayor_executive_structure.ts";

export const mayorExecutiveStructureSourceId = "mayor.executive_structure" as const;
export const dcJurisdiction = "dc" as const;

export interface MayorExecutiveStructureSourceDef extends MayorExecutiveStructureReaderSource {
  id: typeof mayorExecutiveStructureSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface MayorExecutiveStructureSourceBinding {
  source: MayorExecutiveStructureSourceDef;
  interpret: typeof interpretMayorExecutiveStructure;
}

const orgChartPageKey = "organizational-charts";
const executiveBranchPageKey = "executive-branch";

export const mayorExecutiveStructureSource: MayorExecutiveStructureSourceDef = {
  id: mayorExecutiveStructureSourceId,
  jurisdiction: dcJurisdiction,
  type: "mayor.executive_structure",
  pages: [
    {
      key: orgChartPageKey,
      url:
        "https://mayor.dc.gov/page/organizational-charts-agencies-and-offices-under-mayors-authority",
    },
    {
      key: executiveBranchPageKey,
      url: "https://mayor.dc.gov/page/executive-branch-0",
    },
  ],
  entries: [
    office("executive-office-of-the-mayor", "Executive Office of the Mayor"),
    office("office-of-communications", "Office of Communications", "executive-office-of-the-mayor"),
    office(
      "mayors-office-of-community-relations-and-services",
      "Mayor's Office of Community Relations and Services",
      "executive-office-of-the-mayor",
    ),
    office(
      "mayors-office-of-talent-and-appointments",
      "Mayor's Office of Talent and Appointments",
      "executive-office-of-the-mayor",
    ),
    office(
      "mayors-office-of-policy-and-innovation",
      "Mayor's Office of Policy and Innovation",
      "executive-office-of-the-mayor",
    ),
    office(
      "mayors-office-of-the-general-counsel",
      "Mayor's Office of the General Counsel",
      "executive-office-of-the-mayor",
    ),
    office(
      "mayors-office-of-legal-counsel",
      "Mayor's Office of Legal Counsel",
      "executive-office-of-the-mayor",
    ),
    office(
      "mayors-office-of-community-affairs",
      "Mayor's Office of Community Affairs",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-the-senior-advisor",
      "Office of the Senior Advisor",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-policy-and-legislative-affairs",
      "Office of Policy and Legislative Affairs",
      "office-of-the-senior-advisor",
    ),
    office(
      "office-of-federal-and-regional-affairs",
      "Office of Federal and Regional Affairs",
      "office-of-the-senior-advisor",
    ),
    office("office-of-the-secretary", "Office of the Secretary", "office-of-the-senior-advisor"),
    office(
      "office-of-the-city-administrator",
      "Office of the City Administrator",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
      "Office of the Deputy Mayor for Operations and Infrastructure",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-the-deputy-mayor-for-health-and-human-services",
      "Office of the Deputy Mayor for Health and Human Services",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-the-deputy-mayor-for-planning-and-economic-development",
      "Office of the Deputy Mayor for Planning and Economic Development",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-the-deputy-mayor-for-education",
      "Office of the Deputy Mayor for Education",
      "executive-office-of-the-mayor",
    ),
    office(
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
      "Office of the Deputy Mayor for Public Safety and Justice",
      "executive-office-of-the-mayor",
    ),
    office("internal-services", "Internal Services", "office-of-the-city-administrator"),
    reportsTo(
      "mayors-office-on-african-affairs",
      "Mayor's Office on African Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-on-african-american-affairs",
      "Mayor's Office on African American Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-on-asian-and-pacific-islander-affairs",
      "Mayor's Office on Asian and Pacific Islander Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-of-the-clean-city",
      "Mayor's Office of the Clean City",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-on-fathers-men-and-boys",
      "Mayor's Office on Fathers, Men, and Boys",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-on-latino-affairs",
      "Mayor's Office on Latino Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-of-lgbtq-affairs",
      "Mayor's Office of LGBTQ Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-of-nightlife-and-culture",
      "Mayor's Office of Nightlife and Culture",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-of-religious-affairs",
      "Mayor's Office of Religious Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-on-returning-citizens-affairs",
      "Mayor's Office on Returning Citizens Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-of-veterans-affairs",
      "Mayor's Office of Veterans Affairs",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-of-volunteerism-and-partnerships",
      "Mayor's Office of Volunteerism and Partnerships",
      "mayors-office-of-community-affairs",
    ),
    reportsTo(
      "mayors-office-on-womens-policy-and-initiatives",
      "Mayor's Office on Women's Policy and Initiatives",
      "mayors-office-of-community-affairs",
    ),
    agencyRef(
      "district-department-of-transportation",
      "District Department of Transportation",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-motor-vehicles",
      "Department of Motor Vehicles",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-public-works",
      "Department of Public Works",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-for-hire-vehicles",
      "Department of For-Hire Vehicles",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-buildings",
      "Department of Buildings",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-licensing-and-consumer-protection",
      "Department of Licensing and Consumer Protection",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-energy-and-environment",
      "Department of Energy and Environment",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef(
      "department-of-insurance-securities-and-banking",
      "Department of Insurance, Securities and Banking",
      "office-of-the-deputy-mayor-for-operations-and-infrastructure",
    ),
    agencyRef("dc-health", "DC Health", "office-of-the-deputy-mayor-for-health-and-human-services"),
    agencyRef(
      "department-of-human-services",
      "Department of Human Services",
      "office-of-the-deputy-mayor-for-health-and-human-services",
    ),
    agencyRef(
      "child-and-family-services-agency",
      "Child and Family Services Agency",
      "office-of-the-deputy-mayor-for-health-and-human-services",
    ),
    agencyRef(
      "department-of-behavioral-health",
      "Department of Behavioral Health",
      "office-of-the-deputy-mayor-for-health-and-human-services",
    ),
    agencyRef(
      "department-of-health-care-finance",
      "Department of Health Care Finance",
      "office-of-the-deputy-mayor-for-health-and-human-services",
    ),
    agencyRef(
      "department-of-aging-and-community-living",
      "Department of Aging and Community Living",
      "office-of-the-deputy-mayor-for-health-and-human-services",
    ),
    agencyRef(
      "department-of-housing-and-community-development",
      "Department of Housing and Community Development",
      "office-of-the-deputy-mayor-for-planning-and-economic-development",
    ),
    agencyRef(
      "office-of-planning",
      "Office of Planning",
      "office-of-the-deputy-mayor-for-planning-and-economic-development",
    ),
    agencyRef(
      "office-of-cable-television-film-music-and-entertainment",
      "Office of Cable Television, Film, Music and Entertainment",
      "office-of-the-deputy-mayor-for-planning-and-economic-development",
    ),
    agencyRef(
      "department-of-small-and-local-business-development",
      "Department of Small and Local Business Development",
      "office-of-the-deputy-mayor-for-planning-and-economic-development",
    ),
    agencyRef(
      "office-of-the-state-superintendent-of-education",
      "Office of the State Superintendent of Education",
      "office-of-the-deputy-mayor-for-education",
    ),
    agencyRef(
      "department-of-parks-and-recreation",
      "Department of Parks and Recreation",
      "office-of-the-deputy-mayor-for-education",
    ),
    agencyRef(
      "department-of-employment-services",
      "Department of Employment Services",
      "office-of-the-deputy-mayor-for-education",
    ),
    agencyRef(
      "metropolitan-police-department",
      "Metropolitan Police Department",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "homeland-security-and-emergency-management-agency",
      "Homeland Security and Emergency Management Agency",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "office-of-the-chief-medical-examiner",
      "Office of the Chief Medical Examiner",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "office-of-victim-services-and-justice-grants",
      "Office of Victim Services and Justice Grants",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "office-of-neighborhood-safety-and-engagement",
      "Office of Neighborhood Safety and Engagement",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "office-of-human-rights",
      "Office of Human Rights",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "department-of-youth-rehabilitation-services",
      "Department of Youth Rehabilitation Services",
      "office-of-the-deputy-mayor-for-public-safety-and-justice",
    ),
    agencyRef(
      "department-of-general-services",
      "Department of General Services",
      "internal-services",
    ),
    agencyRef(
      "office-of-the-chief-technology-officer",
      "Office of the Chief Technology Officer",
      "internal-services",
    ),
    agencyRef(
      "office-of-contracting-and-procurement",
      "Office of Contracting and Procurement",
      "internal-services",
    ),
    agencyRef(
      "department-of-human-resources",
      "Department of Human Resources",
      "internal-services",
    ),
    agencyRef("office-of-risk-management", "Office of Risk Management", "internal-services"),
    agencyRef("office-of-disability-rights", "Office of Disability Rights", "internal-services"),
    agencyRef(
      "office-of-labor-relations-and-collective-bargaining",
      "Office of Labor Relations and Collective Bargaining",
      "internal-services",
    ),
  ],
};

export const mayorExecutiveStructureBinding: MayorExecutiveStructureSourceBinding = {
  source: mayorExecutiveStructureSource,
  interpret: interpretMayorExecutiveStructure,
};

function office(key: string, name: string, parentKey?: string) {
  return {
    key,
    name,
    pageKey: orgChartPageKey,
    entryKind: "office" as const,
    parentKey,
    relationKind: parentKey ? "part_of" as const : undefined,
  };
}

function reportsTo(key: string, name: string, parentKey: string) {
  return {
    key,
    name,
    pageKey: orgChartPageKey,
    entryKind: "office" as const,
    parentKey,
    relationKind: "reports_to" as const,
  };
}

function agencyRef(key: string, name: string, parentKey: string) {
  return {
    key,
    name,
    pageKey: orgChartPageKey,
    entryKind: "agency_ref" as const,
    parentKey,
    relationKind: "reports_to" as const,
  };
}
