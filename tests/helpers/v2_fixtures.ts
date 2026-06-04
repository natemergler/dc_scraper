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

export const dcgisBoardsCommissionsCouncilsMetadataFixture = {
  name: "District Boards Commissions and Councils",
  fields: [
    { name: "ENTITY_ID", type: "esriFieldTypeDouble", alias: "Entity ID" },
    { name: "NAME", type: "esriFieldTypeString", alias: "Name" },
    { name: "SHORT_NAME", type: "esriFieldTypeString", alias: "Short Name" },
    { name: "ACRONYM", type: "esriFieldTypeString", alias: "Acronym" },
    { name: "GOVERNING_AGENCY", type: "esriFieldTypeString", alias: "Governing Agency" },
    { name: "ADDRESS", type: "esriFieldTypeString", alias: "Address" },
    { name: "TYPE", type: "esriFieldTypeString", alias: "Type" },
    { name: "WEB_URL", type: "esriFieldTypeString", alias: "Website" },
    { name: "AUTHORIZING_ORDER_LAW", type: "esriFieldTypeString", alias: "Authorizing Order Law" },
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "CLUSTER_DC", type: "esriFieldTypeString", alias: "DC Cluster" },
  ],
};

export const dcgisBoardsCommissionsCouncilsRowsFixture = {
  features: [
    {
      attributes: {
        ENTITY_ID: 29,
        NAME: "Board of Accountancy",
        SHORT_NAME: "Board of Accountancy",
        ACRONYM: null,
        GOVERNING_AGENCY: "DC Department of Licensing and Consumer Protection",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://www.dcopla.com/accountancy/",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 47-2853.06",
        CLUSTER_DC: null,
      },
    },
    {
      attributes: {
        ENTITY_ID: 119,
        NAME: "Rental Housing Commission",
        SHORT_NAME: "Rental Housing Commission",
        ACRONYM: null,
        GOVERNING_AGENCY: "Department of Housing and Community Development",
        ADDRESS: null,
        TYPE: "Commission",
        WEB_URL: "https://dhcd.dc.gov/service/rental-housing-commission",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 42-3502.02",
        CLUSTER_DC: null,
      },
    },
    {
      attributes: {
        ENTITY_ID: 25,
        NAME: "Advisory Neighborhood Commissions",
        SHORT_NAME: "Advisory Neighborhood Commissions",
        ACRONYM: "ANC",
        GOVERNING_AGENCY: null,
        ADDRESS: null,
        TYPE: "Commission",
        WEB_URL: "https://anc.dc.gov/",
        AUTHORIZING_ORDER_LAW: "B21-0697",
        CLUSTER_DC: null,
      },
    },
  ],
};

export const governmentOperationsCatalogFixture = {
  layers: [
    { id: 13, name: "DC Study Area - Draft", type: "Feature Layer" },
    { id: 10, name: "Early Vote Center", type: "Feature Layer" },
    { id: 9, name: "Election Day Vote Center", type: "Feature Layer" },
    { id: 8, name: "Mail Ballot Drop Boxes", type: "Feature Layer" },
  ],
  tables: [
    { id: 1, name: "FOIA Requests", type: "Table" },
    { id: 5, name: "Enterprise Dataset Inventory", type: "Table" },
    { id: 6, name: "District Government Agencies", type: "Table" },
    { id: 11, name: "Enterprise Dataset Inventory - 2025", type: "Table" },
    { id: 15, name: "Film and Television Rebate Fund", type: "Table" },
    { id: 24, name: "District Boards Commissions and Councils", type: "Table" },
    { id: 35, name: "DC Government Employee Salary", type: "Table" },
    { id: 37, name: "PASS Contracts", type: "Table" },
  ],
};

export const enterpriseDatasetInventoryMetadataFixture = {
  name: "Enterprise Dataset Inventory",
  maxRecordCount: 2,
  fields: [
    { name: "DATASET_ID", type: "esriFieldTypeString", alias: "Dataset Identifier" },
    { name: "PUBLICATION_STATUS", type: "esriFieldTypeString", alias: "Publication Status" },
    { name: "AGENCY_NAME", type: "esriFieldTypeString", alias: "Agency Name" },
    { name: "DATASET_NAME", type: "esriFieldTypeString", alias: "Dataset Name" },
    { name: "DATASET_CATEGORY", type: "esriFieldTypeString", alias: "Dataset Category" },
    { name: "DATASET_STATUS", type: "esriFieldTypeString", alias: "Dataset Status" },
    { name: "DATASET_URL", type: "esriFieldTypeString", alias: "Dataset URL" },
    { name: "SYSTEM_UPDATED_ON", type: "esriFieldTypeDate", alias: "System Updated On" },
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
  ],
};

export const enterpriseDatasetInventoryRowsPageOneFixture = {
  features: [
    {
      attributes: {
        DATASET_ID: "OUC-EDI-000531",
        PUBLICATION_STATUS: "Published",
        AGENCY_NAME: "Office of Unified Communications",
        DATASET_NAME: "311 City Service Requests",
        DATASET_CATEGORY: "Public Services",
        DATASET_STATUS: "Active",
        DATASET_URL: "https://opendata.dc.gov/datasets/DCGIS::311-city-service-requests/about",
        SYSTEM_UPDATED_ON: 1772631031000,
        OBJECTID: 1,
      },
    },
    {
      attributes: {
        DATASET_ID: "DOB-EDI-000474",
        PUBLICATION_STATUS: "Published",
        AGENCY_NAME: "Department of Buildings",
        DATASET_NAME: "Vacant Buildings Inspections",
        DATASET_CATEGORY: "Business and Economic Development",
        DATASET_STATUS: "Active",
        DATASET_URL: null,
        SYSTEM_UPDATED_ON: 1772631116000,
        OBJECTID: 2,
      },
    },
  ],
};

export const enterpriseDatasetInventoryRowsPageTwoFixture = {
  features: [
    {
      attributes: {
        DATASET_ID: "OCFO-EDI-009999",
        PUBLICATION_STATUS: "Audit Completed",
        AGENCY_NAME: "Office of the Chief Financial Officer",
        DATASET_NAME: "Film Rebate Ledger",
        DATASET_CATEGORY: "Government Operations",
        DATASET_STATUS: "Retired",
        DATASET_URL: "https://example.dc.gov/datasets/film-rebate-ledger",
        SYSTEM_UPDATED_ON: 1772633333000,
        OBJECTID: 3,
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

export const dcCourtsHomeFixture = `
<html><body>
  <h2>Superior Court</h2>
  <a href="/superior-court">Superior Court</a>
  <h2>Court of Appeals</h2>
  <a href="/court-of-appeals">Court of Appeals</a>
</body></html>
`;

export const dcCourtOfAppealsFixture = `
<html><body>
  <h1>Court of Appeals</h1>
  <h2>Overview</h2>
  <p>The District of Columbia Court of Appeals is the highest court of the District of Columbia.</p>
</body></html>
`;

export const dcSuperiorCourtFixture = `
<html><body>
  <h1>Superior Court</h1>
  <h2>Divisions, Program, and Office</h2>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/civil-division">Civil Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/crime-victims-compensation-program">Crime Victims Compensation Program</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/criminal-division">Criminal Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/domestic-violence-division">Domestic Violence Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/family-court-operations-division">Family Court Operations Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/family-court-social-services-division">Family Court Social Services Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/multi-door-dispute-resolution-division">Multi-Door Dispute Resolution Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/office-of-the-auditor-master">Office of the Auditor-Master</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/probate-division">Probate Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/special-operations-division">Special Operations Division</a></h4></div>
  <div class="grid-nav--item"><h4><a href="/superior-court/superior-court-divisions/tax-division">Tax Division</a></h4></div>
  <div class="grid-nav--item"><a href="/superior-court/superior-court-divisions/probate-division/probate-self-help-center">Probate Self-Help Center</a></div>
</body></html>
`;

export const begaAboutFixture = `
<html><body>
  <h6 class="site-slogan">Board of Ethics and Government Accountability</h6>
  <h1 class="title" id="page-title">About BEGA</h1>
  <div class="field field-name-body field-type-text-with-summary field-label-hidden">
    <div class="field-items">
      <div class="field-item even" property="content:encoded">
        <p>The Board of Ethics and Government Accountability (BEGA) is an independent agency that administers and enforces the District of Columbia government's Code of Conduct and the laws that promote an open and transparent District government. BEGA includes two independent offices, the <a href="/page/office-government-ethics">Office of Government Ethics</a> (OGE) and the <a href="https://www.open-dc.gov/office-open-government">Office of Open Government</a> (OOG) and a five Member Board.</p>
      </div>
    </div>
  </div>
</body></html>
`;

export const begaOgeFixture = `
<html><body>
  <h1 class="title" id="page-title">Office of Government Ethics</h1>
  <div class="rteleft">
    The <strong>Office of Government Ethics (OGE)</strong> is an office within the Board of Ethics and Government Accountability (BEGA) that investigates allegations of ethical misconduct concerning District government employees and officials.
  </div>
</body></html>
`;

export const begaOogFixture = `
<html><body>
  <title>Office of Open Government | Open DC</title>
  <h1>You need to change a setting in your web browser</h1>
  <h1 class="page-title">Office of Open Government</h1>
  <p class="rtejustify"><a href="https://code.dccouncil.gov/us/dc/council/code/sections/1-1162.05b">The Office of Open Government (OOG)</a> is an office within the Board of Ethics and Government Accountability charged with advancing open governance in the District of Columbia.</p>
  <p>The Office of Open Government is comprised of staff. We are an office within the Board of Ethics and Government Accountability (BEGA) and we are supported by BEGA's Administrative Division.</p>
</body></html>
`;

export const councilCommitteesFixture = `
<html><body>
  <a href="https://dccouncil.gov/committees/committee-of-the-whole/">Committee of the Whole</a>
  <a href="https://dccouncil.gov/committees/committee-on-health/">Committee on Health</a>
</body></html>
`;

export const councilMembersFixture = `
<html><body>
  <main>
    <h3>Chairman</h3>
    <div><a href="https://dccouncil.gov/council/phil-mendelson/">Chairman Phil Mendelson</a></div>
    <h3>Chairperson Pro Tempore</h3>
    <div><a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a></div>
    <h3>At-Large</h3>
    <ul>
      <li><a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a></li>
      <li><a href="https://dccouncil.gov/council/robert-white/">At-Large Councilmember Robert C. White, Jr.</a></li>
      <li><a href="https://dccouncil.gov/council/christina-henderson/">At-Large Councilmember Christina Henderson</a></li>
      <li><a href="https://dccouncil.gov/council/doni-crawford/">At-Large Councilmember Doni Crawford</a></li>
    </ul>
    <h3>Ward Members</h3>
    <ul>
      <li><a href="https://dccouncil.gov/council/brianne-nadeau/">Ward 1 Councilmember Brianne K. Nadeau</a></li>
      <li><a href="https://dccouncil.gov/council/brooke-pinto/">Ward 2 Councilmember Brooke Pinto</a></li>
      <li><a href="https://dccouncil.gov/council/matthew-frumin/">Ward 3 Councilmember Matthew Frumin</a></li>
      <li><a href="https://dccouncil.gov/council/janeese-lewis-george/">Ward 4 Councilmember Janeese Lewis George</a></li>
      <li><a href="https://dccouncil.gov/council/zachary-parker/">Ward 5 Councilmember Zachary Parker</a></li>
      <li><a href="https://dccouncil.gov/council/charles-allen/">Ward 6 Councilmember Charles Allen</a></li>
      <li><a href="https://dccouncil.gov/council/wendell-felder/">Ward 7 Councilmember Wendell Felder</a></li>
      <li><a href="https://dccouncil.gov/council/trayon-white/">Ward 8 Councilmember Trayon White, Jr.</a></li>
    </ul>
  </main>
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
  <main>
    <h2>Councilmembers</h2>
    <h4>Chairperson</h4>
    <p><a href="https://dccouncil.gov/council/christina-henderson/">At-Large Councilmember Christina Henderson</a></p>
    <h4>Councilmembers</h4>
    <ul class="unstyled-list block-list row small-up-1 medium-up-2 large-up-3">
      <li><a href="https://dccouncil.gov/council/charles-allen/">Ward 6 Councilmember Charles Allen</a></li>
      <li><a href="https://dccouncil.gov/council/wendell-felder/">Ward 7 Councilmember Wendell Felder</a></li>
      <li><a href="https://dccouncil.gov/council/brianne-nadeau/">Ward 1 Councilmember Brianne K. Nadeau</a></li>
      <li><a href="https://dccouncil.gov/council/zachary-parker/">Ward 5 Councilmember Zachary Parker</a></li>
    </ul>
  </main>
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

export const ancListingFixture = `
<html><body>
  <p>D.C. Code 1-309.13(j)(1)</p>
  <select name="field_anc_tag_target_id[]">
    <option value="">Select ANC</option>
    <option value="36">ANC 3/4G</option>
    <option value="49">ANC 6C</option>
    <option value="53">ANC 6/8F</option>
  </select>
</body></html>
`;

export const ancProfile6cFixture = `
<html><body>
  <h1>ANC 6C</h1>
  <table class="uk-table uk-table-striped">
    <thead>
      <tr><th>SMD</th><th>Name</th><th>Address</th><th>Phone</th><th>Email</th></tr>
    </thead>
    <tbody>
      <tr><td>6C01</td><td>Jeremiah Foxwell</td><td>private address</td><td>202-555-0101</td><td>foxwell@example.com</td></tr>
      <tr><td>6C02</td><td>Karen Wirt Chairperson</td><td>private address</td><td>202-555-0102</td><td>wirt@example.com</td></tr>
      <tr><td>6C03</td><td>Jay Adelstein Treasurer</td><td>private address</td><td>202-555-0103</td><td>adelstein@example.com</td></tr>
    </tbody>
  </table>
</body></html>
`;

export const ancProfile34gFixture = `
<html><body>
  <h1>ANC 3/4G</h1>
  <table class="uk-table uk-table-striped">
    <thead>
      <tr><th>SMD</th><th>Name</th><th>Address</th><th>Phone</th><th>Email</th></tr>
    </thead>
    <tbody>
      <tr><td>3/4G01</td><td>Ada Sample Vice Chairperson</td><td>private address</td><td>202-555-0111</td><td>ada@example.com</td></tr>
      <tr><td>3/4G02</td><td>Ben Example Secretary</td><td>private address</td><td>202-555-0112</td><td>ben@example.com</td></tr>
    </tbody>
  </table>
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
  <a href="https://dc.gov/page/laws-regulations-and-courts">Laws, Regulations and Courts</a>
  <a href="http://mayor.dc.gov/">Mayor</a>
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
