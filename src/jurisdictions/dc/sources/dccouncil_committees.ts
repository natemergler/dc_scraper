import { type DCCouncilCommitteePagesSource } from "../../../readers/dccouncil_committee_pages.ts";
import { interpretDccouncilCommittees } from "../interpreters/dccouncil_committees.ts";

export const dccouncilCommitteesSourceId = "dccouncil.committees" as const;
export const dcJurisdiction = "dc" as const;

export interface DCCouncilCommitteesSource extends DCCouncilCommitteePagesSource {
  id: typeof dccouncilCommitteesSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface DCCouncilCommitteesSourceBinding {
  source: DCCouncilCommitteesSource;
  interpret: typeof interpretDccouncilCommittees;
}

export const dccouncilCommitteesSource: DCCouncilCommitteesSource = {
  id: dccouncilCommitteesSourceId,
  jurisdiction: dcJurisdiction,
  type: "dccouncil.committees",
  indexUrl: "https://dccouncil.gov/committees/",
};

export const dccouncilCommitteesBinding: DCCouncilCommitteesSourceBinding = {
  source: dccouncilCommitteesSource,
  interpret: interpretDccouncilCommittees,
};
