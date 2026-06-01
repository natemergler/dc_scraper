export const dcgisMetadataFixture = {
  name: "District Government Agencies",
  fields: [
    { name: "AGENCY_ID", type: "esriFieldTypeDouble", alias: "Agency ID#" },
    { name: "AGENCY_NAME", type: "esriFieldTypeString", alias: "Agency Name" },
    { name: "TYPE", type: "esriFieldTypeString", alias: "Type" },
    { name: "BRANCH", type: "esriFieldTypeString", alias: "Branch" },
    { name: "MAYORAL_CLUSTER", type: "esriFieldTypeString", alias: "Mayoral Cluster" },
    { name: "WEB_URL", type: "esriFieldTypeString", alias: "Web URL" },
    { name: "LEGISLATION", type: "esriFieldTypeString", alias: "Legislation" },
  ],
};

export const dcgisRowsFixture = {
  features: [
    {
      attributes: {
        AGENCY_ID: 1001,
        AGENCY_NAME: "Alcoholic Beverage and Cannabis Administration",
        TYPE: "Agency",
        BRANCH: "Executive",
        MAYORAL_CLUSTER: "Planning and Economic Development",
        WEB_URL: "https://abca.dc.gov/",
        LEGISLATION: "D.C. Code § 25-202",
      },
    },
    {
      attributes: {
        AGENCY_ID: 1062,
        AGENCY_NAME: "Mayor's Office on Asian and Pacific Island Affairs",
        TYPE: "Agency",
        BRANCH: "Executive",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://apia.dc.gov/",
        LEGISLATION: "D.C. Code § 1-711",
      },
    },
  ],
};

export const openDcIndexFixture = `
<html><body>
  <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
  <a href="/public-bodies/adult-career-pathways-task-force">Adult Career Pathways Task Force</a>
</body></html>
`;

export const openDcBoardFixture = `
<html><body>
  <h1 class="page-title">Board of Accountancy</h1>
  <div class="field field-name-field-statute-mayors-order field-type-link-field field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06#(b)(1)">D.C. Official Code § 47-2853.06(b)(1)</a></div></div>
  </div>
  <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">DLCP/OPL</div></div>
  </div>
  <div class="view view-meetings-calendar"></div>
</body></html>
`;

export const openDcTaskForceFixture = `
<html><body>
  <h1 class="page-title">Adult Career Pathways Task Force</h1>
  <div class="field field-name-field-statute-mayors-order field-type-link-field field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even"><a href="/file%253A///C%253A/Users/source-user/Documents/Downloads/53207.pdf">Mayor's Order 2023-058</a></div></div>
  </div>
  <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">DOES</div></div>
  </div>
</body></html>
`;

export const openDcStreetHarassmentFixture = `
<html><body>
  <h1 class="page-title">Advisory Committee on Street Harassment</h1>
  <div class="field field-name-field-statute-mayors-order field-type-link-field field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.us/us/dc/council/code/sections/2-1441">D.C. Official Code § 2-1441</a></div></div>
  </div>
  <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">Office of Human Rights</div></div>
  </div>
</body></html>
`;

export const openDcCommissionFixture = `
<html><body>
  <h1 class="page-title">Commission on Example Services</h1>
  <div class="field field-name-field-statute-mayors-order field-type-text field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even">Mayor's Order 2019-010</div></div>
  </div>
  <div class="field field-name-field-administering-agency field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Administering Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">Office of the City Administrator</div></div>
  </div>
  <div class="view view-meetings-calendar">
    <a href="/public-bodies/commission-on-example-services/meetings">Meeting calendar</a>
  </div>
  <div class="field field-name-field-associated-documents field-type-link-field">
    <a href="https://www.open-dc.gov/sites/default/files/dc/sites/example/publication/attachments/commission-charter.pdf">Commission Charter</a>
  </div>
</body></html>
`;

export const councilCommitteesFixture = `
<html><body>
  <a href="https://dccouncil.gov/committees/committee-of-the-whole/">Committee of the Whole</a>
  <a href="https://dccouncil.gov/committees/committee-on-health/">Committee on Health</a>
</body></html>
`;

export const councilCommitteeWholeDetailFixture = `
<html><body>
  <h1>Committee of the Whole</h1>
  <h2>Oversight</h2>
  <ul>
    <li>District of Columbia Public Schools</li>
    <li>Office of the State Superintendent of Education</li>
  </ul>
</body></html>
`;

export const councilCommitteeHealthDetailFixture = `
<html><body>
  <h1>Committee on Health</h1>
  <p>The committee has broad jurisdiction over health agencies.</p>
  <h2>Agencies Under This Committee</h2>
  <ul>
    <li>Department of Health</li>
    <li>Department of Behavioral Health</li>
  </ul>
  <footer>
    <ul>
      <li>twitter</li>
    </ul>
  </footer>
</body></html>
`;

export const limsFixture = JSON.stringify([
  {
    legislationId: 61981,
    legislationNumber: "PR26-0732",
    title:
      "Clemency Board Waiver Authority Second Congressional Review Emergency Declaration Resolution of 2026",
    url: "https://lims.dccouncil.gov/LegislationDetails/GetLegislationDetails/PR26-0732",
  },
]);

export const quickbaseFixture = `
<html><body>
  <title>MOTA Boards and Commissions</title>
  <div>Board Appointments</div>
</body></html>
`;

export const quickbaseAppointmentsCsvFixture = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"District of Columbia Rental Housing Commission","Chairperson (Office of Housing and Community Development designee)","Filled","Jane Doe","Active"
"Adult Career Pathways Task Force","Member (Mayor's Office on Asia and Pacific Island Affairs designee)","Vacant","","Active"
"Council of the District of Columbia","Chairperson","Filled","John Smith","Active"
"Task Force on Inclusive Economic Development","Vice Chair (Office of the Chief Financial Officer designee)","Filled","Alex Doe","Active"
"Downtown Revitalization Committee","Chairperson (Office of Planning designee)","Filled","Jordan Lin","Active"
`;

export const legalEntrypointsFixture = `
<html><body>
  <a href="https://code.dccouncil.gov/">District of Columbia Official Code</a>
  <a href="https://dcregs.dc.gov/">DC Register / DCMR</a>
  <a href="https://mayor.dc.gov/page/mayors-orders">Mayor's Orders</a>
</body></html>
`;

export const admin311Fixture = JSON.stringify({
  name: "311 Service Requests in 2026",
  description: "Data provided by the DC 311 service request center.",
  fields: [
    { name: "SERVICECODE", type: "esriFieldTypeString", alias: "Service Code" },
    { name: "SERVICEORDERSTATUS", type: "esriFieldTypeString", alias: "Status" },
  ],
});

export const admin311WrongLayerFixture = JSON.stringify({
  name: "Child Development Centers",
  description: "Locations of child development centers.",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "NAME", type: "esriFieldTypeString", alias: "Name" },
  ],
});

export const adminBudgetPageFixture =
  `<html><body><h1>Budget</h1><a href="https://opencheckbook.dc.gov/">Open Checkbook</a></body></html>`;

export const adminProcurementPageFixture =
  `<html><body><h1>Doing Business with DC Government</h1><a href="https://contracts.ocp.dc.gov/">PASS</a></body></html>`;

export const arcgisServiceLayersFixture = {
  layers: [
    { id: 5, name: "ABCA Liquor License Locations" },
    { id: 7, name: "Bias Crime" },
    { id: 8, name: "Mail Ballot Drop Boxes" },
    { id: 9, name: "Election Day Vote Center" },
    { id: 10, name: "Certificate Of Occupancy Points" },
    { id: 24, name: "Vehicular Crash Data" },
    { id: 29, name: "Shot Spotter Gun Shots" },
    { id: 33, name: "Parcel Lots" },
    { id: 35, name: "Reservations" },
    { id: 39, name: "Tax Lots" },
    { id: 45, name: "Home Occupancy Permit" },
    { id: 46, name: "Certificate of Occupancy" },
  ],
};

export const arcgisLayerDetailFixture = (name: string) => ({
  name,
  description: `${name} description`,
  capabilities: "Query",
  maxRecordCount: 2000,
  advancedQueryCapabilities: {
    supportsPagination: true,
  },
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "AGENCY", type: "esriFieldTypeString", alias: "Agency" },
  ],
});
