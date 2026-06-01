import {
  buildReviewItemId,
  type ConnectorResult,
  type SourceDefinition,
  type SourceEndpointDefinition,
} from "../domain.ts";
import { artifact } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";

const quickbaseSource: SourceDefinition = {
  sourceId: "mota.quickbase",
  title: "MOTA Quickbase Public Surface",
  kind: "quickbase_app",
  accessMethod: "official_public_app_overview",
  baseUrl: "https://octo.quickbase.com/db/bjngwsngm?a=td",
  notes: "Anonymous app overview is public, but table/report access may still require sign-in.",
};

export const quickbaseConnector: SourceConnector = {
  sourceId: quickbaseSource.sourceId,
  source: quickbaseSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "mota.quickbase.app",
      sourceId: quickbaseSource.sourceId,
      title: "Quickbase public app overview",
      kind: "page",
      url: quickbaseSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const response = await context.fetcher(quickbaseSource.baseUrl);
    const html = await response.text();
    const feasible = parseQuickbaseFeasibility(html);
    return {
      source: quickbaseSource,
      endpointResults: [{
        endpoint,
        status: feasible.feasible ? "success" : "failed",
        errorText: feasible.reason,
        artifacts: [artifact("page", "html", quickbaseSource.baseUrl, html)],
        parsed: feasible.feasible ? undefined : {
          reviewItems: [{
            reviewItemId: buildReviewItemId("mota.quickbase", "status"),
            itemType: "source_status",
            subjectId: "mota.quickbase",
            reason: feasible.reason,
            defaultAction: "defer",
            details: { access: "anonymous-overview-only" },
          }],
        },
      }],
    };
  },
};

function parseQuickbaseFeasibility(html: string): { feasible: boolean; reason: string } {
  if (html.includes("Sign in") && html.includes("EOM - MOTA Dashboard")) {
    return {
      feasible: false,
      reason:
        "Anonymous access currently reaches the Quickbase app overview, but public table/report data access was not discovered without sign-in.",
    };
  }
  return {
    feasible: true,
    reason: "Anonymous Quickbase access appears available.",
  };
}
