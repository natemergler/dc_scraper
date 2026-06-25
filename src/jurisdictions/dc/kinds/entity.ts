export type DcPublicNodeCategory =
  | "executive"
  | "legislative"
  | "public_body"
  | "neighborhood"
  | "judicial"
  | "representation"
  | "legal_authority";

export interface DcEntityKindSemantics {
  kind: string;
  releaseDescription: string;
  publicCategory?: DcPublicNodeCategory;
}

export const dcEntityKindSemantics = [
  {
    kind: "dc.agency",
    releaseDescription: "District agency or agency-like organization entries.",
    publicCategory: "executive",
  },
  {
    kind: "dc.office",
    releaseDescription: "Mayor, BEGA, OGE, OOG, and other office entries.",
    publicCategory: "executive",
  },
  {
    kind: "dc.board",
    releaseDescription: "Board public-body entries.",
    publicCategory: "public_body",
  },
  {
    kind: "dc.commission",
    releaseDescription: "Commission public-body entries.",
    publicCategory: "public_body",
  },
  {
    kind: "dc.authority",
    releaseDescription: "Authority public-body entries when source rows are present.",
    publicCategory: "public_body",
  },
  {
    kind: "dc.council",
    releaseDescription: "Council or council-like public-body organization entries.",
    publicCategory: "public_body",
  },
  {
    kind: "dc.committee",
    releaseDescription: "Council committee organization entries.",
    publicCategory: "legislative",
  },
  {
    kind: "dc.councilmember",
    releaseDescription: "Councilmember person entries from official roster pages.",
    publicCategory: "representation",
  },
  {
    kind: "dc.elected_office",
    releaseDescription: "Elected office position entries.",
    publicCategory: "representation",
  },
  {
    kind: "dc.ward",
    releaseDescription: "Ward area entries.",
    publicCategory: "representation",
  },
  {
    kind: "dc.anc",
    releaseDescription: "Advisory Neighborhood Commission organization entries.",
    publicCategory: "neighborhood",
  },
  {
    kind: "dc.smd",
    releaseDescription: "Single Member District area entries.",
    publicCategory: "neighborhood",
  },
  {
    kind: "dc.anc_commissioner_seat",
    releaseDescription: "ANC commissioner seat position entries.",
    publicCategory: "neighborhood",
  },
  {
    kind: "dc.court_system",
    releaseDescription: "Court system root entries.",
    publicCategory: "judicial",
  },
  {
    kind: "dc.court",
    releaseDescription: "Court entries from D.C. Courts structure.",
    publicCategory: "judicial",
  },
  {
    kind: "dc.court_division",
    releaseDescription: "Court division entries from D.C. Courts structure.",
    publicCategory: "judicial",
  },
  {
    kind: "dc.legal_authority",
    releaseDescription: "Explicit D.C. Code, D.C. Law, and Mayor's Order authority locators.",
    publicCategory: "legal_authority",
  },
  {
    kind: "dc.legal_source",
    releaseDescription: "Official legal-source entrypoint anchors.",
  },
] as const satisfies readonly DcEntityKindSemantics[];

const dcEntityKindSemanticsByKind: ReadonlyMap<string, DcEntityKindSemantics> = new Map(
  dcEntityKindSemantics.map((semantics): [string, DcEntityKindSemantics] => [
    semantics.kind,
    semantics,
  ]),
);

export function dcEntityKindDescription(kind: string): string | undefined {
  return dcEntityKindSemanticsByKind.get(kind)?.releaseDescription;
}

export function dcPublicNodeCategory(kind: string): DcPublicNodeCategory | undefined {
  return dcEntityKindSemanticsByKind.get(kind)?.publicCategory;
}

export function dcPublicNodeKinds(): string[] {
  return dcEntityKindSemantics
    .filter((semantics) => "publicCategory" in semantics)
    .map((semantics) => semantics.kind);
}
