import { assert, assertEquals } from "@std/assert";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import {
  openDcBoardFixture,
  openDcCommissionFixture,
  openDcStreetHarassmentFixture,
  openDcTaskForceFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("Open DC second detail-page shape yields administered relationship, legal ref, and document links", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/commission-on-example-services">Commission on Example Services</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-on-example-services":
          return openDcCommissionFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.items?.some((item) =>
      item.itemType === "document_link" && String(item.body.href).includes("commission-charter.pdf")
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Office of the City Administrator"
    ),
  );
  assertEquals(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "authorized_by"
    ),
    false,
  );
  assert(
    detail.legalRefs?.some((legalRef) =>
      legalRef.legalRefId ===
        "legal.open_dc.public_bodies.commission_on_example_services_authority" &&
      legalRef.attachEntityRef === "dc.commission_on_example_services" &&
      legalRef.attachRelationshipRef === undefined
    ),
  );
});

Deno.test("Open DC keeps non-legal authority text as source evidence instead of legal ref work", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/apple-tree-early-learning-pcs">Apple Tree Early Learning PCS</a>
            <a href="/public-bodies/working-group-jobs-wages-and-benefits">Working Group on Jobs, Wages and Benefits</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/apple-tree-early-learning-pcs":
          return `<html><body>
            <h1 class="page-title">Apple Tree Early Learning PCS</h1>
            <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
              <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
              <div class="field-items"><div class="field-item even"><a href="https://www.appletreeinstitute.org/">N/A</a></div></div>
            </div>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/working-group-jobs-wages-and-benefits":
          return `<html><body>
            <h1 class="page-title">Working Group on Jobs, Wages and Benefits</h1>
            <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
              <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
              <div class="field-items"><div class="field-item even">MO 2016-083</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    detail.items?.find((item) => item.itemKey === "apple-tree-early-learning-pcs")?.body
      .enablingAuthority,
    "N/A",
  );
  assertEquals(
    detail.legalRefs?.map((legalRef) => ({
      legalRefId: legalRef.legalRefId,
      citationText: legalRef.citationText,
      normalizedCitation: legalRef.normalizedCitation,
      refType: legalRef.refType,
    })),
    [{
      legalRefId: "legal.open_dc.public_bodies.working_group_jobs_wages_and_benefits_authority",
      citationText: "MO 2016-083",
      normalizedCitation: "Mayor's Order 2016-083",
      refType: "mayors_order",
    }],
  );
});

Deno.test("Open DC fetch includes priority Council oversight endpoint pages beyond an explicit limit", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/advisory-committee-street-harassment">Advisory Committee on Street Harassment</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/advisory-committee-street-harassment":
          return openDcStreetHarassmentFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId ===
        "candidate.open_dc.public_bodies.advisory_committee_street_harassment"
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.rawValue === "Office of Human Rights" &&
      candidate.toEntityRef === "dc.office_of_human_rights"
    ),
  );
});

Deno.test("Open DC default fetch reaches every canonical detail page", async () => {
  const slugs = Array.from({ length: 20 }, (_, index) => `body-${index + 1}`);
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      if (url === "https://www.open-dc.gov/public-bodies") {
        return `<html><body>${
          slugs.map((slug, index) => `<a href="/public-bodies/${slug}">Body ${index + 1}</a>`).join(
            "",
          )
        }</body></html>`;
      }
      const slug = url.split("/").pop();
      if (slug && slugs.includes(slug)) {
        const name = slug.replace("body-", "Body ");
        return `<html><body><h1 class="page-title">${name}</h1></body></html>`;
      }
      throw new Error(`Unexpected url ${url}`);
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  assertEquals(result.endpointResults[1].artifacts.length, 20);
});

Deno.test("Open DC live-shell index pulls supplemental public body pages without materializing generic shell titles", async () => {
  const seenUrls: string[] = [];
  const fetcher = async (url: string) => {
    seenUrls.push(url);
    return {
      status: 200,
      text: async () => {
        switch (url) {
          case "https://www.open-dc.gov/public-bodies":
            return `<html><body>
              <div>Boards &amp; Commissions Tools</div>
              <div>Office of Open Government</div>
              <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies-general-0":
            return `<html><body>
              <a href="/public-bodies/board-pharmacy">Board of Pharmacy</a>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies/board-accountancy":
            return openDcBoardFixture;
          case "https://www.open-dc.gov/public-bodies/board-pharmacy":
            return `<html><body><h1 class="page-title">Public Bodies</h1></body></html>`;
          default:
            throw new Error(`Unexpected url ${url}`);
        }
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    };
  };
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    seenUrls,
    [
      "https://www.open-dc.gov/public-bodies",
      "https://www.open-dc.gov/public-bodies-general-0",
      "https://www.open-dc.gov/public-bodies/board-accountancy",
      "https://www.open-dc.gov/public-bodies/board-pharmacy",
    ],
  );
  assertEquals(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId === "candidate.open_dc.public_bodies.board_pharmacy"
    ),
    false,
  );
});

Deno.test("Open DC default fetch keeps all canonical detail pages and prefers cleaner duplicate slugs", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy-0">Board of Accountancy</a>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/adult-career-pathways-task-force">Adult Career Pathways Task Force</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  assertEquals(result.endpointResults[1].artifacts.length, 2);
  assertEquals(
    result.endpointResults[1].artifacts.map((item) => item.fetchedUrl),
    [
      "https://www.open-dc.gov/public-bodies/board-accountancy",
      "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force",
    ],
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(detail.entityCandidates?.length, 2);
  assert(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId === "candidate.open_dc.public_bodies.board_accountancy" &&
      candidate.officialUrl === "https://www.open-dc.gov/public-bodies/board-accountancy"
    ),
  );
  assert(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId ===
        "candidate.open_dc.public_bodies.adult_career_pathways_task_force"
    ),
  );
});

Deno.test("Open DC acronym parentheticals reuse the base public-body identity", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/juvenile-justice-advisory-group-jjag">Juvenile Justice Advisory Group (JJAG)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/juvenile-justice-advisory-group-jjag":
          return `<html><body><h1 class="page-title">Juvenile Justice Advisory Group (JJAG)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(detail.entityCandidates?.[0]?.name, "Juvenile Justice Advisory Group");
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.juvenile_justice_advisory_group",
  );
});

Deno.test("Open DC acronym parentheticals still honor known entity aliases", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/public-charter-school-board-pcsb">Public Charter School Board (PCSB)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/public-charter-school-board-pcsb":
          return `<html><body><h1 class="page-title">Public Charter School Board (PCSB)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(detail.entityCandidates?.[0]?.name, "Public Charter School Board");
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.public_charter_school_board_pcsb",
  );
});

Deno.test("Open DC known alias parentheticals reuse the accepted full-label identity", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc">Washington D.C. Convention and Tourism Corporation (Destination DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc":
          return `<html><body><h1 class="page-title">Washington D.C. Convention and Tourism Corporation (Destination DC)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    detail.entityCandidates?.[0]?.name,
    "Washington D.C. Convention and Tourism Corporation (Destination DC)",
  );
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.washington_d_c_convention_and_tourism_corporation",
  );
});

Deno.test("Open DC default bounded fetch prioritizes resolvable alias pages over generic early rows", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc">Washington D.C. Convention and Tourism Corporation (Destination DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc":
          return `<html><body><h1 class="page-title">Washington D.C. Convention and Tourism Corporation (Destination DC)</h1></body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  assertEquals(
    result.endpointResults[1].artifacts.map((item) => item.fetchedUrl),
    [
      "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc",
    ],
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    detail.entityCandidates?.[0]?.name,
    "Washington D.C. Convention and Tourism Corporation (Destination DC)",
  );
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.washington_d_c_convention_and_tourism_corporation",
  );
});

Deno.test("Open DC default bounded fetch does not boost acronym-only pages ahead of generic early rows", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/district-columbia-taxicab-commission-dctc">District of Columbia Taxicab Commission (DCTC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/district-columbia-taxicab-commission-dctc":
          return `<html><body><h1 class="page-title">District of Columbia Taxicab Commission (DCTC)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  assertEquals(
    result.endpointResults[1].artifacts.map((item) => item.fetchedUrl),
    [
      "https://www.open-dc.gov/public-bodies/board-accountancy",
    ],
  );
});

Deno.test("Open DC keeps taxonomy-only agency labels as evidence instead of relationship endpoints", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/board-elections">Board of Elections</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-elections":
          return `<html><body>
            <h1 class="page-title">Board of Elections</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Independent Agency</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher,
  }));
  const detail = result.endpointResults[1].parsed;
  assertEquals(detail?.relationshipCandidates?.length ?? 0, 0);
  assertEquals(detail?.items?.[0]?.body.governingAgency, "Independent Agency");
});

Deno.test("Open DC surfaces suspicious agency labels as source review work", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/common-lottery-board">Common Lottery Board</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/common-lottery-board":
          return `<html><body>
            <h1 class="page-title">Common Lottery Board</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Department of Eduaction</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher,
  }));
  const detail = result.endpointResults[1].parsed;
  assertEquals(detail?.relationshipCandidates?.length ?? 0, 0);
  const sourceReview = detail?.reviewItems?.find((item) => item.itemType === "source_status");
  assert(sourceReview);
  assertEquals(sourceReview.subjectId, "open_dc.public_bodies");
  assertEquals(sourceReview.defaultAction, "defer");
  assertEquals(sourceReview.details.needsReview, true);
  assertEquals(sourceReview.details.rawValue, "Department of Eduaction");
  assertEquals(sourceReview.details.fieldPath, "governingAgency");
});

Deno.test("Open DC governing agency labels can resolve qualified deputy mayor aliases", async () => {
  const indexFixture = `
  <html><body>
    <a href="/public-bodies/juvenile-abscondence-review-committee">Juvenile Abscondence Review Committee</a>
  </body></html>
  `;
  const detailFixture = `
  <html><body>
    <h1 class="page-title">Juvenile Abscondence Review Committee</h1>
    <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
      <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
      <div class="field-items"><div class="field-item even">Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)</div></div>
    </div>
  </body></html>
  `;
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return indexFixture;
        case "https://www.open-dc.gov/public-bodies/juvenile-abscondence-review-committee":
          return detailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.rawValue === "Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)" &&
      candidate.toEntityRef === "dc.office_of_the_deputy_mayor_for_public_safety_and_justice"
    ),
  );
});
