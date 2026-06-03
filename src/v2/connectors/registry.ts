import { dcgisAgenciesConnector, dcgisBoardsCommissionsCouncilsConnector } from "./dcgis.ts";
import { openDcConnector } from "./open_dc.ts";
import { councilCommitteesConnector, councilLimsConnector } from "./council.ts";
import { councilMembersConnector } from "./council_members.ts";
import { oancAncProfilesConnector } from "./oanc.ts";
import { quickbaseConnector } from "./quickbase.ts";
import { legalEntrypointsConnector } from "./legal.ts";
import {
  admin311Connector,
  adminBudgetConnector,
  adminCrimeConnector,
  adminElectionsConnector,
  adminEnterpriseDatasetInventoryConnector,
  adminPermitsConnector,
  adminProcurementConnector,
  adminPropertyConnector,
} from "./admin.ts";
import type { ConnectorContext, Fetcher, SourceConnector } from "./shared.ts";
import { defaultFetcher } from "./shared.ts";

export const connectors: SourceConnector[] = [
  dcgisAgenciesConnector,
  dcgisBoardsCommissionsCouncilsConnector,
  openDcConnector,
  councilMembersConnector,
  councilCommitteesConnector,
  councilLimsConnector,
  oancAncProfilesConnector,
  quickbaseConnector,
  legalEntrypointsConnector,
  admin311Connector,
  adminBudgetConnector,
  adminEnterpriseDatasetInventoryConnector,
  adminPermitsConnector,
  adminCrimeConnector,
  adminProcurementConnector,
  adminPropertyConnector,
  adminElectionsConnector,
];

export function getConnector(sourceId: string): SourceConnector {
  const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
  if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
  return connector;
}

export function createConnectorContext(
  options: { fetcher?: Fetcher; limit?: number },
): ConnectorContext {
  return {
    fetcher: options.fetcher ?? defaultFetcher,
    limit: options.limit,
  };
}
