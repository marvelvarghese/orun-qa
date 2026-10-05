import type {
  CreateAreaRequest,
  CreateEdgeRequest,
  CreateFeatureRequest,
  CreateHubRequest,
  FeatureMap,
  FeatureManifest,
  ImportResult,
  FeatureRipple,
  PublicArea,
  PublicFeature,
  PublicFeatureEdge,
  PublicHub,
  UpdateFeatureRequest,
  CreateScenarioRequest,
  ApproveScenarioRequest,
  UpdateScenarioRequest,
  PublicScenario,
  CreateRunRequest,
  PublicRun,
  PostResultRequest,
  PublicResult,
  PublicRecording,
} from "@saas/contracts/qa";

import type { Transport, RequestOptions } from "./transport.js";

/**
 * Orun QA resource client (QA1 — the feature map; QA2 — scenarios, runs and recordings).
 *
 * Org-scoped: every method takes `orgId` (org_…) and, below the hub list, a `hubId` (hub_…).
 * Maps to `apps/qa-worker` via the api-edge `qa-facade` route.
 */
export class QaClient {
  constructor(private readonly transport: Transport) {}

  private base(orgId: string, hubId?: string): string {
    const root = `/v1/organizations/${encodeURIComponent(orgId)}/qa/hubs`;
    return hubId ? `${root}/${encodeURIComponent(hubId)}` : root;
  }

  listHubs(orgId: string, opts: RequestOptions = {}): Promise<{ hubs: PublicHub[] }> {
    return this.transport.request({ method: "GET", path: this.base(orgId) }, opts);
  }

  createHub(orgId: string, body: CreateHubRequest, opts: RequestOptions = {}): Promise<{ hub: PublicHub }> {
    return this.transport.request({ method: "POST", path: this.base(orgId), body }, opts);
  }

  getHub(orgId: string, hubId: string, opts: RequestOptions = {}): Promise<{ hub: PublicHub }> {
    return this.transport.request({ method: "GET", path: this.base(orgId, hubId) }, opts);
  }

  listAreas(orgId: string, hubId: string, opts: RequestOptions = {}): Promise<{ areas: PublicArea[] }> {
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/areas` }, opts);
  }

  createArea(orgId: string, hubId: string, body: CreateAreaRequest, opts: RequestOptions = {}): Promise<{ area: PublicArea }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/areas`, body }, opts);
  }

  listFeatures(orgId: string, hubId: string, opts: RequestOptions = {}): Promise<{ features: PublicFeature[] }> {
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/features` }, opts);
  }

  createFeature(orgId: string, hubId: string, body: CreateFeatureRequest, opts: RequestOptions = {}): Promise<{ feature: PublicFeature }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/features`, body }, opts);
  }

  getFeature(
    orgId: string,
    hubId: string,
    featureId: string,
    opts: RequestOptions = {},
  ): Promise<{ feature: PublicFeature; ripple: FeatureRipple }> {
    return this.transport.request(
      { method: "GET", path: `${this.base(orgId, hubId)}/features/${encodeURIComponent(featureId)}` },
      opts,
    );
  }

  updateFeature(
    orgId: string,
    hubId: string,
    featureId: string,
    body: UpdateFeatureRequest,
    opts: RequestOptions = {},
  ): Promise<{ feature: PublicFeature }> {
    return this.transport.request(
      { method: "PATCH", path: `${this.base(orgId, hubId)}/features/${encodeURIComponent(featureId)}`, body },
      opts,
    );
  }

  /** POST …/import — fill a hub from a manifest; idempotent by name. */
  importManifest(orgId: string, hubId: string, body: FeatureManifest, opts: RequestOptions = {}): Promise<{ result: ImportResult }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/import`, body }, opts);
  }

  getMap(orgId: string, hubId: string, opts: RequestOptions = {}): Promise<FeatureMap> {
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/map` }, opts);
  }

  createEdge(orgId: string, hubId: string, body: CreateEdgeRequest, opts: RequestOptions = {}): Promise<{ edge: PublicFeatureEdge }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/edges`, body }, opts);
  }

  confirmEdge(orgId: string, hubId: string, edgeId: string, opts: RequestOptions = {}): Promise<{ edge: PublicFeatureEdge }> {
    return this.transport.request(
      { method: "POST", path: `${this.base(orgId, hubId)}/edges/${encodeURIComponent(edgeId)}/confirm` },
      opts,
    );
  }

  deleteEdge(orgId: string, hubId: string, edgeId: string, opts: RequestOptions = {}): Promise<{ deleted: true }> {
    return this.transport.request(
      { method: "DELETE", path: `${this.base(orgId, hubId)}/edges/${encodeURIComponent(edgeId)}` },
      opts,
    );
  }

  // ── QA2: scenarios ──

  listScenarios(orgId: string, hubId: string, query: { feature?: string } = {}, opts: RequestOptions = {}): Promise<{ scenarios: PublicScenario[] }> {
    const qs = query.feature ? `?feature=${encodeURIComponent(query.feature)}` : "";
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/scenarios${qs}` }, opts);
  }

  getScenario(orgId: string, hubId: string, scenarioId: string, opts: RequestOptions = {}): Promise<{ scenario: PublicScenario; history: PublicResult[] }> {
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/scenarios/${encodeURIComponent(scenarioId)}` }, opts);
  }

  createScenario(orgId: string, hubId: string, body: CreateScenarioRequest, opts: RequestOptions = {}): Promise<{ scenario: PublicScenario }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/scenarios`, body }, opts);
  }

  updateScenario(orgId: string, hubId: string, scenarioId: string, body: UpdateScenarioRequest, opts: RequestOptions = {}): Promise<{ scenario: PublicScenario }> {
    return this.transport.request({ method: "PATCH", path: `${this.base(orgId, hubId)}/scenarios/${encodeURIComponent(scenarioId)}`, body }, opts);
  }

  /** The PM's sign-off: only approved scenarios count toward a feature's health. */
  approveScenario(orgId: string, hubId: string, scenarioId: string, body: ApproveScenarioRequest, opts: RequestOptions = {}): Promise<{ scenario: PublicScenario }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/scenarios/${encodeURIComponent(scenarioId)}/approve`, body }, opts);
  }

  // ── QA2: runs, results and recordings ──

  listRuns(orgId: string, hubId: string, query: { limit?: number } = {}, opts: RequestOptions = {}): Promise<{ runs: PublicRun[] }> {
    const qs = query.limit ? `?limit=${query.limit}` : "";
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/runs${qs}` }, opts);
  }

  getRun(orgId: string, hubId: string, runId: string, opts: RequestOptions = {}): Promise<{ run: PublicRun; results: PublicResult[] }> {
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/runs/${encodeURIComponent(runId)}` }, opts);
  }

  createRun(orgId: string, hubId: string, body: CreateRunRequest, opts: RequestOptions = {}): Promise<{ run: PublicRun }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/runs`, body }, opts);
  }

  postResult(
    orgId: string,
    hubId: string,
    runId: string,
    body: PostResultRequest,
    opts: RequestOptions = {},
  ): Promise<{ result: PublicResult }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/runs/${encodeURIComponent(runId)}/results`, body }, opts);
  }

  finishRun(orgId: string, hubId: string, runId: string, body: { errored?: boolean } = {}, opts: RequestOptions = {}): Promise<{ run: PublicRun; results: PublicResult[] }> {
    return this.transport.request({ method: "POST", path: `${this.base(orgId, hubId)}/runs/${encodeURIComponent(runId)}/finish`, body }, opts);
  }

  getRecording(orgId: string, hubId: string, recordingId: string, opts: RequestOptions = {}): Promise<{ recording: PublicRecording }> {
    return this.transport.request({ method: "GET", path: `${this.base(orgId, hubId)}/recordings/${encodeURIComponent(recordingId)}` }, opts);
  }
}
