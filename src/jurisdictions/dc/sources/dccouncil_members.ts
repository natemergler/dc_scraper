import { type DCCouncilmembersSource } from "../../../readers/dccouncil_councilmembers.ts";
import { interpretDccouncilMembers } from "../interpreters/dccouncil_members.ts";

export const dccouncilMembersSourceId = "dccouncil.members" as const;
export const dcJurisdiction = "dc" as const;

export interface DCCouncilMembersSource extends DCCouncilmembersSource {
  id: typeof dccouncilMembersSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface DCCouncilMembersSourceBinding {
  source: DCCouncilMembersSource;
  interpret: typeof interpretDccouncilMembers;
}

export const dccouncilMembersSource: DCCouncilMembersSource = {
  id: dccouncilMembersSourceId,
  jurisdiction: dcJurisdiction,
  type: "dccouncil.members",
  rosterUrl: "https://dccouncil.gov/councilmembers/",
};

export const dccouncilMembersBinding: DCCouncilMembersSourceBinding = {
  source: dccouncilMembersSource,
  interpret: interpretDccouncilMembers,
};
