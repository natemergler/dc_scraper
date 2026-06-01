import {
  buildDatasetId,
  type ConnectorResult,
  type DatasetInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
} from "../domain.ts";
import { artifact, fieldEvidence, toAbsoluteUrl } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";
import { normalizeName, stripHtml } from "../domain.ts";

const legalEntrypointsSource: SourceDefinition = {
  sourceId: "legal.entrypoints",
  title: "DC Legal Entrypoints",
  kind: "legal_source_index",
  accessMethod: "official_page_html",
  baseUrl: "https://dc.gov/page/laws-regulations-and-courts",
};

export const legalEntrypointsConnector: SourceConnector = {
  sourceId: legalEntrypointsSource.sourceId,
  source: legalEntrypointsSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "legal.entrypoints.main",
      sourceId: legalEntrypointsSource.sourceId,
      title: "DC legal entrypoints page",
      kind: "page",
      url: legalEntrypointsSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const response = await context.fetcher(legalEntrypointsSource.baseUrl);
    const html = await response.text();
    const sources = parseLegalEntrypoints(html);
    const items: SourceItemInput[] = sources.map((source) => ({
      itemKey: source.slug,
      itemType: "legal_source_entry",
      title: source.name,
      body: source,
    }));
    return {
      source: legalEntrypointsSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("page", "html", legalEntrypointsSource.baseUrl, html)],
        parsed: {
          items,
          datasets: sources.map((source) => ({
            datasetId: buildDatasetId(legalEntrypointsSource.sourceId, source.slug),
            sourceItemKey: source.slug,
            name: source.name,
            category: "legal_source",
            ownerName: "District of Columbia",
            accessMethod: "official_page_html",
            artifactDepth: "page",
            officialUrl: source.url,
            evidence: [fieldEvidence("link", source.url)],
          })),
        },
      }],
    };
  },
};

function parseLegalEntrypoints(html: string): Array<{ slug: string; name: string; url: string }> {
  const matches = [...html.matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/gsi)];
  const results: Array<{ slug: string; name: string; url: string }> = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const url = toAbsoluteUrl(legalEntrypointsSource.baseUrl, match[1]);
    const name = normalizeName(stripHtml(match[2]));
    if (!name) continue;
    if (
      !/Official Code|Mayor'?s Orders|Laws, Regulations and Courts|DCMR|Register/i.test(name) &&
      !/code\.dccouncil\.gov|dcregs\.dc\.gov|mayor\.dc\.gov/.test(url)
    ) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      slug: url.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase(),
      name,
      url,
    });
  }
  return results;
}
