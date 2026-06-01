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
    <div class="field-items"><div class="field-item even"><a href="https://dcregs.dc.gov/Common/MayorOrders.aspx?Type=MayorOrder&amp;OrderNumber=2023-058">Mayor's Order 2023-058</a></div></div>
  </div>
  <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">DOES</div></div>
  </div>
</body></html>
`;

export const councilCommitteesFixture = `
<html><body>
  <a href="https://dccouncil.gov/committees/committee-of-the-whole/">Committee of the Whole</a>
  <a href="https://dccouncil.gov/committees/committee-on-health/">Committee on Health</a>
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
  <title>EOM - MOTA Dashboard</title>
  <div>Sign in</div>
</body></html>
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
  fields: [
    { name: "SERVICECODE", type: "esriFieldTypeString", alias: "Service Code" },
    { name: "SERVICEORDERSTATUS", type: "esriFieldTypeString", alias: "Status" },
  ],
});
