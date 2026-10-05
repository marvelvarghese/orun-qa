// Orun QA wire contracts (QA1 — the feature map; QA2 — scenarios and runs). Envelopes follow { data, meta }.

/** Derived on read from a feature's latest scenario results; never stored. */
export type FeatureHealth = "verified" | "attention" | "broken" | "not_tested";

export interface PublicHub {
  id: string; // hub_…
  orgId: string; // org_…
  name: string;
  slug: string;
  stageUrl: string | null;
  prodUrl: string | null;
  orunbaseWorkspace: string | null;
  createdAt: string;
}

export interface PublicArea {
  id: string; // area_…
  hubId: string;
  name: string;
  position: number;
}

export interface PublicFeature {
  id: string; // feat_…
  hubId: string;
  areaId: string | null;
  name: string;
  description: string;
  ownerUserId: string | null;
  qaUserId: string | null;
  public: boolean;
  codeRefs: string[];
  specLinks: string[];
  health: FeatureHealth;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface PublicFeatureEdge {
  id: string; // edge_…
  from: string; // feat_… the feature relied on
  to: string; // feat_… the feature that needs it
  source: "human" | "agent";
  confirmed: boolean;
}

/** GET /v1/organizations/{org}/qa/hubs/{hub}/map — everything the Insights map draws. */
export interface FeatureMap {
  hub: PublicHub;
  areas: PublicArea[];
  features: PublicFeature[];
  edges: PublicFeatureEdge[];
}

/** What breaks when a feature breaks, and what it relies on. Computed from confirmed edges. */
export interface FeatureRipple {
  feature: string;
  reliesOn: string[];
  breaksDirectly: string[];
  breaksNext: string[];
}

export const QA_LIMITS = {
  nameMax: 120,
  descriptionMax: 2000,
  refsMax: 50,
  refMax: 300,
  positionMax: 10000,
} as const;

export interface CreateHubRequest {
  name: string;
  slug?: string;
  stageUrl?: string | null;
  prodUrl?: string | null;
}

export interface CreateAreaRequest {
  name: string;
  position?: number;
}

export interface CreateFeatureRequest {
  name: string;
  description?: string;
  areaId?: string | null;
  ownerUserId?: string | null;
  qaUserId?: string | null;
  public?: boolean;
  codeRefs?: string[];
  specLinks?: string[];
}

export type UpdateFeatureRequest = Partial<CreateFeatureRequest> & { status?: "active" | "archived" };

export interface CreateEdgeRequest {
  from: string;
  to: string;
  source?: "human" | "agent";
}

/**
 * Walk confirmed edges from a feature. `breaksDirectly` are features that need it;
 * `breaksNext` are everything further downstream; `reliesOn` is everything upstream.
 */
export function computeRipple(featureId: string, edges: ReadonlyArray<Pick<PublicFeatureEdge, "from" | "to" | "confirmed">>): FeatureRipple {
  const confirmed = edges.filter((e) => e.confirmed);
  const children = (id: string) => confirmed.filter((e) => e.from === id).map((e) => e.to);
  const parents = (id: string) => confirmed.filter((e) => e.to === id).map((e) => e.from);

  const breaksDirectly = [...new Set(children(featureId))].filter((id) => id !== featureId);
  const seen = new Set<string>([featureId, ...breaksDirectly]);
  const breaksNext: string[] = [];
  const queue = [...breaksDirectly];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const c of children(id)) {
      if (!seen.has(c)) {
        seen.add(c);
        breaksNext.push(c);
        queue.push(c);
      }
    }
  }

  const reliesOn: string[] = [];
  const up = new Set<string>([featureId]);
  const upQueue = parents(featureId);
  while (upQueue.length > 0) {
    const id = upQueue.shift()!;
    if (up.has(id)) continue;
    up.add(id);
    reliesOn.push(id);
    upQueue.push(...parents(id));
  }

  return { feature: featureId, reliesOn, breaksDirectly, breaksNext };
}

/**
 * POST /v1/organizations/{org}/qa/hubs/{hub}/import — fill a hub from a manifest.
 * Idempotent by name. Areas: missing ones are created, existing ones are kept as
 * they are. Features: missing ones are created; existing ones are updated only in
 * the fields the manifest gives, and only when something differs. Edges: missing
 * ones are created confirmed; an existing unconfirmed one is confirmed. Nothing is
 * deleted. A feature's `area` may name an area in the manifest or one the hub has.
 */
export interface FeatureManifest {
  areas: { name: string; position?: number }[];
  features: {
    name: string;
    description?: string;
    area?: string | null;
    codeRefs?: string[];
    specLinks?: string[];
  }[];
  /** "to needs from", by feature name. */
  edges: { from: string; to: string }[];
}

export interface ImportResult {
  areas: { created: number; kept: number };
  features: { created: number; updated: number; kept: number };
  edges: { created: number; confirmed: number; kept: number };
}

/** Sized so one request finishes comfortably; split larger product maps across imports. */
export const MANIFEST_LIMITS = { areas: 30, features: 100, edges: 300 } as const;

// ── QA2: scenarios, runs, results and recordings ────────────────────────────

/** What the runner does for one step. Selectors are visible text or test ids, never CSS. */
export type StepAction =
  | { type: "goto"; path: string }
  | { type: "click"; text?: string; testId?: string; role?: string }
  | { type: "fill"; label?: string; testId?: string; value: string }
  | { type: "press"; key: string }
  | { type: "expect_text"; text: string }
  | { type: "expect_url"; path: string }
  /** With a role, the element must have it, e.g. { role: "heading", text: "Archive a project" }. */
  | { type: "expect_visible"; text?: string; testId?: string; role?: string }
  | { type: "expect_response"; method: string; path: string; status: number };

export const STEP_ACTION_TYPES = ["goto", "click", "fill", "press", "expect_text", "expect_url", "expect_visible", "expect_response"] as const;

export interface PublicStep {
  ord: number;
  text: string;
  action: StepAction;
}

export type ScenarioKind = "screens_apis" | "api_only";
export type ScenarioCadence = "daily" | "release" | "manual";
export type ScenarioState = "draft" | "approved" | "quarantined" | "archived";

export interface PublicScenario {
  id: string; // scn_…
  hubId: string;
  featureId: string;
  name: string;
  expected: string;
  kind: ScenarioKind;
  cadence: ScenarioCadence;
  state: ScenarioState;
  asRole: string | null;
  steps: PublicStep[];
  /** The newest result of this scenario, if it has run. */
  last: PublicResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScenarioRequest {
  featureId: string;
  name: string;
  expected?: string;
  kind?: ScenarioKind;
  cadence?: ScenarioCadence;
  asRole?: string | null;
  steps: { text: string; action: StepAction }[];
}

/**
 * Approving is its own route (POST …/scenarios/{id}/approve), the PM's call. The
 * body pins the version reviewed; a scenario changed since then is a 409.
 */
export interface ApproveScenarioRequest {
  updatedAt: string;
}

/** Changing an approved scenario's steps, expectation or role sends it back to draft. */
export type UpdateScenarioRequest = Partial<Omit<CreateScenarioRequest, "featureId" | "kind">> & { state?: "draft" | "quarantined" | "archived" };

export type RunTrigger = "schedule" | "deploy" | "manual" | "try";
export type RunStatus = "running" | "passed" | "failed" | "errored";
export type Verdict = "works" | "fails" | "skipped" | "errored";

export interface PublicRun {
  id: string; // run_…
  hubId: string;
  trigger: RunTrigger;
  env: string;
  ref: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
}

export interface StepTiming {
  ord: number;
  startMs: number;
  endMs: number;
  ok: boolean;
}

export interface ApiCall {
  method: string;
  path: string;
  status: number;
  ms: number;
}

export interface PublicResult {
  id: string; // res_…
  runId: string;
  scenarioId: string;
  featureId: string;
  verdict: Verdict;
  failingStep: number | null;
  message: string;
  durationMs: number;
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  recordingId: string | null; // rec_…
  createdAt: string;
}

export interface CreateRunRequest {
  trigger: RunTrigger;
  env?: string;
  ref?: string | null;
}

/** POST …/runs/{run}/results — one scenario's outcome, with its rrweb recording if it had a screen. */
export interface PostResultRequest {
  scenarioId: string;
  verdict: Verdict;
  failingStep?: number | null;
  message?: string;
  durationMs: number;
  stepTimings?: StepTiming[];
  apiCalls?: ApiCall[];
  /** rrweb events: JSON array → gzip → base64. */
  recording?: { encoding: "rrweb+gzip+base64"; events: string };
}

export interface PublicRecording {
  id: string;
  resultId: string;
  encoding: "rrweb+gzip+base64";
  sizeBytes: number;
  events: string;
}

export const RUN_LIMITS = {
  stepsMax: 40,
  stepTextMax: 300,
  valueMax: 2000,
  messageMax: 4000,
  apiCallsMax: 200,
  /** base64 characters; ~6 MB keeps a recording well inside one request and one row. */
  recordingMax: 6_000_000,
  durationMax: 3_600_000,
  runsListMax: 50,
} as const;

/**
 * A feature's health from the newest result of each of its approved scenarios:
 * any fails → broken; any errored → attention; at least one works and the rest
 * works or skipped → verified; nothing run → not_tested.
 */
export function deriveHealth(verdicts: readonly Verdict[]): FeatureHealth {
  if (verdicts.includes("fails")) return "broken";
  if (verdicts.includes("errored")) return "attention";
  if (verdicts.includes("works")) return "verified";
  return "not_tested";
}
