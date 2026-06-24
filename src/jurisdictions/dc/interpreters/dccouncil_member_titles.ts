import { fileSafeLedgerId } from "./context.ts";

export interface ParsedCouncilmemberTitle {
  displayName: string;
  officeId: string | null;
  officeName: string | null;
  officeType: string | null;
  roleLabel: string | null;
  wardNumber: string | null;
}

const WARD_COUNCILMEMBER_RE = /^Ward\s+(\d+)\s+Councilmember\s+(.+)$/i;
const AT_LARGE_COUNCILMEMBER_RE = /^At-Large\s+Councilmember\s+(.+)$/i;
const CHAIRMAN_RE = /^Chairman\s+(.+)$/i;

export function parseCouncilmemberTitle(value: string): ParsedCouncilmemberTitle {
  const normalized = value.trim().replace(/\s+/g, " ");
  const wardMatch = normalized.match(WARD_COUNCILMEMBER_RE);
  if (wardMatch) {
    const wardNumber = wardMatch[1];
    return {
      displayName: wardMatch[2].trim(),
      officeId: makeWardCouncilmemberOfficeId(wardNumber),
      officeName: `Ward ${wardNumber} Councilmember`,
      officeType: "ward_councilmember",
      roleLabel: `Ward ${wardNumber} Councilmember`,
      wardNumber,
    };
  }

  const atLargeMatch = normalized.match(AT_LARGE_COUNCILMEMBER_RE);
  if (atLargeMatch) {
    return {
      displayName: atLargeMatch[1].trim(),
      officeId: "dc.elected_office:at-large-councilmember",
      officeName: "At-Large Councilmember",
      officeType: "at_large_councilmember",
      roleLabel: "At-Large Councilmember",
      wardNumber: null,
    };
  }

  const chairmanMatch = normalized.match(CHAIRMAN_RE);
  if (chairmanMatch) {
    return {
      displayName: chairmanMatch[1].trim(),
      officeId: "dc.elected_office:council-chairman",
      officeName: "Chairman",
      officeType: "council_chairman",
      roleLabel: "Chairman",
      wardNumber: null,
    };
  }

  return {
    displayName: normalized,
    officeId: null,
    officeName: null,
    officeType: null,
    roleLabel: null,
    wardNumber: null,
  };
}

export function makeWardId(wardNumber: string): string {
  return `dc.ward:${fileSafeLedgerId(wardNumber)}`;
}

function makeWardCouncilmemberOfficeId(wardNumber: string): string {
  return `dc.elected_office:ward-${fileSafeLedgerId(wardNumber)}-councilmember`;
}
