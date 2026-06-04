import { dcgisAgenciesConnector, dcgisBoardsCommissionsCouncilsConnector } from "./dcgis.ts";
import { begaConnector } from "./bega.ts";
import { dcCourtsConnector } from "./courts.ts";
import { openDcConnector } from "./open_dc.ts";
import { councilCommitteesConnector, councilLimsConnector } from "./council.ts";
import { councilMembersConnector } from "./council_members.ts";
import { mayorOfficeConnector } from "./mayor.ts";
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
import type {
  ConnectorContext,
  ConnectorProgressEvent,
  Fetcher,
  SourceConnector,
} from "./shared.ts";
import { defaultFetcher } from "./shared.ts";

export const connectors: SourceConnector[] = [
  dcgisAgenciesConnector,
  dcgisBoardsCommissionsCouncilsConnector,
  dcCourtsConnector,
  begaConnector,
  openDcConnector,
  mayorOfficeConnector,
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
  options: {
    fetcher?: Fetcher;
    limit?: number;
    onProgress?: (event: ConnectorProgressEvent) => void;
  },
): ConnectorContext {
  return {
    fetcher: options.fetcher ?? defaultFetcher,
    limit: options.limit,
    onProgress: options.onProgress,
  };
}
