import type { QaRunsRepository, Run, RunResult, Scenario, ScenarioState, Step } from "@saas/db/qa";
import {
  QA_LIMITS,
  RUN_LIMITS,
  STEP_ACTION_TYPES,
  type ApiCall,
  type PublicRecording,
  type PublicResult,
  type PublicRun,
  type PublicScenario,
  type StepAction,
  type StepTiming,
  type Verdict,
} from "@saas/contracts/qa";
import { errorResponse, successResponse, validationError } from "./http.js";
import { fromPublic, toPublic } from "./ids.js";
import { allowed, fromRepoError, nextId, notFound, now, readJson, str, withRepo, type Ctx, type Fields } from "./handlers.js";

// ── public shapes ────────────────────────────────────────────────────────────

export function publicResult(r: RunResult): PublicResult {
  return {
    id: toPublic("res", r.id),
    runId: toPublic("run", r.runId),
    scenarioId: toPublic("scn", r.scenarioId),
    featureId: toPublic("feat", r.featureId),
    verdict: r.verdict,
    failingStep: r.failingStep,
    message: r.message,
    durationMs: r.durationMs,
    stepTimings: r.stepTimings,
    apiCalls: r.apiCalls,
    recordingId: r.recordingId ? toPublic("rec", r.recordingId) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function publicScenario(s: Scenario, last: RunResult | undefined): PublicScenario {
  return {
    id: toPublic("scn", s.id),
    hubId: toPublic("hub", s.hubId),
    featureId: toPublic("feat", s.featureId),
    name: s.name,
    expected: s.expected,
    kind: s.kind,
    cadence: s.cadence,
    state: s.state,
    asRole: s.asRole,
    steps: s.steps.map((st) => ({ ord: st.ord, text: st.text, action: st.action as unknown as StepAction })),
    last: last ? publicResult(last) : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function publicRun(r: Run): PublicRun {
  return {
    id: toPublic("run", r.id),
    hubId: toPublic("hub", r.hubId),
    trigger: r.trigger,
    env: r.env,
    ref: r.ref,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

async function latestByScenario(runs: QaRunsRepository, orgId: string, hubId: string): Promise<Map<string, RunResult>> {
  const r = await runs.latestResults(orgId, hubId);
  return new Map(r.ok ? r.value.map((x) => [x.scenarioId, x]) : []);
}

// ── validation ───────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const shortStr = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
const optShort = (v: unknown, max: number) => v === undefined || shortStr(v, max);
const isPath = (v: unknown) => typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && v.length <= QA_LIMITS.refMax;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** One step's action, or why it is not one. Only the fields its type uses are kept. */
function parseAction(v: unknown): StepAction | string {
  if (!isObj(v) || typeof v.type !== "string" || !(STEP_ACTION_TYPES as readonly string[]).includes(v.type)) {
    return `type is one of ${STEP_ACTION_TYPES.join(", ")}`;
  }
  const max = QA_LIMITS.nameMax * 2;
  switch (v.type) {
    case "goto":
      return isPath(v.path) ? { type: "goto", path: v.path as string } : "goto needs a path starting with /";
    case "click":
    case "expect_visible": {
      if (!optShort(v.text, max) || !optShort(v.testId, max) || (v.type === "click" && !optShort(v.role, 40))) return "text, testId and role are short strings";
      if (v.text === undefined && v.testId === undefined) return `${v.type} needs text or testId`;
      const a: Record<string, unknown> = { type: v.type };
      if (v.text !== undefined) a.text = v.text;
      if (v.testId !== undefined) a.testId = v.testId;
      if (v.type === "click" && v.role !== undefined) a.role = v.role;
      return a as StepAction;
    }
    case "fill": {
      if (!optShort(v.label, max) || !optShort(v.testId, max)) return "label and testId are short strings";
      if (v.label === undefined && v.testId === undefined) return "fill needs label or testId";
      if (typeof v.value !== "string" || v.value.length > RUN_LIMITS.valueMax) return `fill needs a value of at most ${RUN_LIMITS.valueMax} characters`;
      const a: Record<string, unknown> = { type: "fill", value: v.value };
      if (v.label !== undefined) a.label = v.label;
      if (v.testId !== undefined) a.testId = v.testId;
      return a as StepAction;
    }
    case "press":
      return shortStr(v.key, 40) ? { type: "press", key: v.key as string } : "press needs a key";
    case "expect_text":
      return shortStr(v.text, RUN_LIMITS.valueMax) ? { type: "expect_text", text: v.text as string } : "expect_text needs text";
    case "expect_url":
      return isPath(v.path) ? { type: "expect_url", path: v.path as string } : "expect_url needs a path starting with /";
    case "expect_response":
      if (typeof v.method !== "string" || !METHODS.has(v.method.toUpperCase())) return "expect_response needs a method";
      if (!isPath(v.path)) return "expect_response needs a path starting with /";
      if (!int(v.status, 100, 599)) return "expect_response needs a status from 100 to 599";
      return { type: "expect_response", method: v.method.toUpperCase(), path: v.path as string, status: v.status as number };
    default:
      return "unknown step type";
  }
}

function parseSteps(fields: Fields, body: Record<string, unknown>, required: boolean): Step[] | undefined {
  const v = body.steps;
  if (v === undefined) {
    if (required) fields.steps = ["Required"];
    return undefined;
  }
  if (!Array.isArray(v) || v.length === 0) {
    fields.steps = ["A list of at least one step"];
    return undefined;
  }
  if (v.length > RUN_LIMITS.stepsMax) {
    fields.steps = [`At most ${RUN_LIMITS.stepsMax} steps`];
    return undefined;
  }
  const steps: Step[] = [];
  v.forEach((x: unknown, i) => {
    if (!isObj(x)) {
      fields[`steps.${i}`] = ["Must be an object"];
      return;
    }
    const text = typeof x.text === "string" ? x.text.trim() : "";
    if (text.length === 0 || text.length > RUN_LIMITS.stepTextMax) (fields[`steps.${i}`] ??= []).push(`text: 1 to ${RUN_LIMITS.stepTextMax} characters`);
    const action = parseAction(x.action);
    if (typeof action === "string") (fields[`steps.${i}`] ??= []).push(`action: ${action}`);
    else steps.push({ ord: i, text, action: action as unknown as Record<string, unknown> });
  });
  return steps;
}

function enumField<T extends string>(fields: Fields, body: Record<string, unknown>, key: string, allowedValues: readonly T[]): T | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !(allowedValues as readonly string[]).includes(v)) {
    fields[key] = [`One of ${allowedValues.join(", ")}`];
    return undefined;
  }
  return v as T;
}

function optRole(fields: Fields, body: Record<string, unknown>): string | null | undefined {
  if (body.asRole === null) return null;
  const v = str(fields, body, "asRole", { max: 40 });
  return v === undefined ? undefined : v === "" ? null : v;
}

const stepIds = (ctx: Ctx, steps: Step[]) => steps.map(() => nextId(ctx));

// ── scenarios ────────────────────────────────────────────────────────────────

export function listScenarios(ctx: Ctx, hubId: string, url: URL): Promise<Response> {
  const featureParam = url.searchParams.get("feature");
  const featureId = featureParam ? fromPublic("feat", featureParam) : undefined;
  if (featureParam && !featureId) return Promise.resolve(validationError(ctx.requestId, { feature: ["Must be a feature id (feat_…)"] }));
  return withRepo(ctx, "qa.feature.read", async (repo, runs) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const [r, last] = await Promise.all([
      runs.listScenarios(ctx.orgId, hubId, featureId ? { featureId } : {}),
      latestByScenario(runs, ctx.orgId, hubId),
    ]);
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    return successResponse({ scenarios: r.value.map((s) => publicScenario(s, last.get(s.id))) }, ctx.requestId);
  });
}

export function getScenario(ctx: Ctx, hubId: string, scenarioId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (_repo, runs) => {
    const r = await runs.getScenario(ctx.orgId, hubId, scenarioId);
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    const recent = await runs.featureResults(ctx.orgId, r.value.featureId, 50);
    const history = recent.ok ? recent.value.filter((x) => x.scenarioId === scenarioId) : [];
    return successResponse({ scenario: publicScenario(r.value, history[0]), history: history.slice(0, 20).map(publicResult) }, ctx.requestId);
  });
}

export async function createScenario(ctx: Ctx, hubId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const featureId = fromPublic("feat", typeof body.featureId === "string" ? body.featureId : null);
  if (!featureId) fields.featureId = ["Must be a feature id (feat_…)"];
  const name = str(fields, body, "name", { required: true, max: QA_LIMITS.nameMax });
  const expected = str(fields, body, "expected", { max: QA_LIMITS.descriptionMax });
  const kind = enumField(fields, body, "kind", ["screens_apis", "api_only"] as const);
  const cadence = enumField(fields, body, "cadence", ["daily", "release", "manual"] as const);
  const asRole = optRole(fields, body);
  const steps = parseSteps(fields, body, true);
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  // A new scenario is a draft until the PM approves it; only approved ones gate health.
  return withRepo(ctx, "qa.scenario.write", async (_repo, runs) => {
    const r = await runs.createScenario({
      id: nextId(ctx),
      orgId: ctx.orgId,
      hubId,
      featureId: featureId!,
      name: name!,
      expected: expected ?? "",
      kind: kind ?? "screens_apis",
      cadence: cadence ?? "daily",
      state: "draft",
      asRole: asRole ?? null,
      // eslint-disable-next-line no-restricted-syntax -- qa created_by is TEXT holding the public actor id, like qa.feature_edges.confirmed_by
      createdBy: ctx.actor.subjectId,
      steps: steps!,
      stepIds: stepIds(ctx, steps!),
      createdAt: now(ctx),
    });
    return r.ok ? successResponse({ scenario: publicScenario(r.value, undefined) }, ctx.requestId, 201) : fromRepoError(r.error, ctx.requestId);
  });
}

export async function updateScenario(ctx: Ctx, hubId: string, scenarioId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const name = str(fields, body, "name", { max: QA_LIMITS.nameMax });
  if (name !== undefined && name.length === 0) fields.name = ["Must not be empty"];
  const expected = str(fields, body, "expected", { max: QA_LIMITS.descriptionMax });
  const cadence = enumField(fields, body, "cadence", ["daily", "release", "manual"] as const);
  const state = enumField(fields, body, "state", ["draft", "quarantined", "archived"] as const);
  const asRole = optRole(fields, body);
  const steps = parseSteps(fields, body, false);
  if ([name, expected, cadence, state, asRole, steps].every((v) => v === undefined) && Object.keys(fields).length === 0) fields.body = ["Nothing to update"];
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.scenario.write", async (_repo, runs) => {
    const cur = await runs.getScenario(ctx.orgId, hubId, scenarioId);
    if (!cur.ok) return fromRepoError(cur.error, ctx.requestId);
    if (cur.value.state === "archived") return errorResponse("conflict", "An archived scenario cannot be changed", 409, ctx.requestId);
    const isPm = await allowed(ctx, "qa.feature.write");
    // Taking an approved scenario out of the gate (quarantine, archive) is the PM's call.
    if (!isPm && cur.value.state === "approved" && (state === "quarantined" || state === "archived")) return notFound(ctx.requestId);
    if (!isPm && state === "quarantined") return notFound(ctx.requestId);
    // Changing what an approved scenario does sends it back for approval.
    const changesBehaviour = steps !== undefined || (expected !== undefined && expected !== cur.value.expected) || (asRole !== undefined && asRole !== cur.value.asRole);
    let nextState: ScenarioState | undefined = state;
    if (nextState === undefined && changesBehaviour && cur.value.state === "approved") nextState = "draft";
    const r = await runs.updateScenario(ctx.orgId, hubId, scenarioId, {
      name,
      expected,
      cadence,
      state: nextState,
      asRole,
      steps,
      stepIds: steps ? stepIds(ctx, steps) : undefined,
      updatedAt: now(ctx),
    });
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    const last = await latestByScenario(runs, ctx.orgId, hubId);
    return successResponse({ scenario: publicScenario(r.value, last.get(r.value.id)) }, ctx.requestId);
  });
}

export function approveScenario(ctx: Ctx, hubId: string, scenarioId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.write", async (_repo, runs) => {
    const cur = await runs.getScenario(ctx.orgId, hubId, scenarioId);
    if (!cur.ok) return fromRepoError(cur.error, ctx.requestId);
    if (cur.value.state === "archived") return errorResponse("conflict", "An archived scenario cannot be approved", 409, ctx.requestId);
    if (cur.value.state === "approved") {
      const last = await latestByScenario(runs, ctx.orgId, hubId);
      return successResponse({ scenario: publicScenario(cur.value, last.get(scenarioId)) }, ctx.requestId);
    }
    const r = await runs.updateScenario(ctx.orgId, hubId, scenarioId, { state: "approved", updatedAt: now(ctx) });
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    const last = await latestByScenario(runs, ctx.orgId, hubId);
    return successResponse({ scenario: publicScenario(r.value, last.get(scenarioId)) }, ctx.requestId);
  });
}

// ── runs ─────────────────────────────────────────────────────────────────────

export function listRuns(ctx: Ctx, hubId: string, url: URL): Promise<Response> {
  const raw = url.searchParams.get("limit");
  const limit = raw === null ? 20 : Number(raw);
  if (!int(limit, 1, RUN_LIMITS.runsListMax)) return Promise.resolve(validationError(ctx.requestId, { limit: [`A whole number from 1 to ${RUN_LIMITS.runsListMax}`] }));
  return withRepo(ctx, "qa.feature.read", async (repo, runs) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await runs.listRuns(ctx.orgId, hubId, limit);
    return r.ok ? successResponse({ runs: r.value.map(publicRun) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export function getRun(ctx: Ctx, hubId: string, runId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (_repo, runs) => {
    const r = await runs.getRun(ctx.orgId, hubId, runId);
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    const results = await runs.listResults(ctx.orgId, runId);
    if (!results.ok) return fromRepoError(results.error, ctx.requestId);
    return successResponse({ run: publicRun(r.value), results: results.value.map(publicResult) }, ctx.requestId);
  });
}

export async function createRun(ctx: Ctx, hubId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const trigger = enumField(fields, body, "trigger", ["schedule", "deploy", "manual", "try"] as const);
  if (body.trigger === undefined) fields.trigger = ["Required"];
  const env = str(fields, body, "env", { max: 40 });
  const ref = body.ref === null ? null : str(fields, body, "ref", { max: 200 });
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.run.write", async (repo, runs) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await runs.createRun({
      id: nextId(ctx),
      orgId: ctx.orgId,
      hubId,
      trigger: trigger!,
      env: env || "stage",
      ref: ref || null,
      // eslint-disable-next-line no-restricted-syntax -- qa created_by is TEXT holding the public actor id, like qa.feature_edges.confirmed_by
      createdBy: ctx.actor.subjectId,
      startedAt: now(ctx),
    });
    return r.ok ? successResponse({ run: publicRun(r.value) }, ctx.requestId, 201) : fromRepoError(r.error, ctx.requestId);
  });
}

/** A finished run's status from its results, unless the runner says it errored. */
export function runStatusFrom(verdicts: readonly Verdict[]): "passed" | "failed" | "errored" {
  if (verdicts.includes("fails")) return "failed";
  if (verdicts.includes("errored")) return "errored";
  return "passed";
}

export async function finishRun(ctx: Ctx, hubId: string, runId: string, request: Request): Promise<Response> {
  const body = (await readJson(request)) ?? {};
  const fields: Fields = {};
  const errored = body.errored === undefined ? false : body.errored;
  if (typeof errored !== "boolean") fields.errored = ["Must be true or false"];
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.run.write", async (_repo, runs) => {
    const run = await runs.getRun(ctx.orgId, hubId, runId);
    if (!run.ok) return fromRepoError(run.error, ctx.requestId);
    const results = await runs.listResults(ctx.orgId, runId);
    if (!results.ok) return fromRepoError(results.error, ctx.requestId);
    const status = errored ? "errored" : runStatusFrom(results.value.map((r) => r.verdict));
    const r = await runs.finishRun(ctx.orgId, hubId, runId, status, now(ctx));
    if (!r.ok) {
      if (r.error.kind === "conflict") return errorResponse("conflict", "That run has already finished", 409, ctx.requestId);
      return fromRepoError(r.error, ctx.requestId);
    }
    return successResponse({ run: publicRun(r.value), results: results.value.map(publicResult) }, ctx.requestId);
  });
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function parseTimings(fields: Fields, v: unknown): StepTiming[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > RUN_LIMITS.stepsMax) {
    fields.stepTimings = [`A list of at most ${RUN_LIMITS.stepsMax} entries`];
    return undefined;
  }
  const ok = v.every((t: unknown) => isObj(t) && int(t.ord, 0, RUN_LIMITS.stepsMax) && int(t.startMs, 0, RUN_LIMITS.durationMax) && int(t.endMs, 0, RUN_LIMITS.durationMax) && typeof t.ok === "boolean");
  if (!ok) {
    fields.stepTimings = ["Each entry is {ord, startMs, endMs, ok}"];
    return undefined;
  }
  return (v as Record<string, unknown>[]).map((t) => ({ ord: t.ord as number, startMs: t.startMs as number, endMs: t.endMs as number, ok: t.ok as boolean }));
}

function parseApiCalls(fields: Fields, v: unknown): ApiCall[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > RUN_LIMITS.apiCallsMax) {
    fields.apiCalls = [`A list of at most ${RUN_LIMITS.apiCallsMax} entries`];
    return undefined;
  }
  const ok = v.every((c: unknown) => isObj(c) && shortStr(c.method, 10) && shortStr(c.path, QA_LIMITS.refMax) && int(c.status, 0, 599) && int(c.ms, 0, RUN_LIMITS.durationMax));
  if (!ok) {
    fields.apiCalls = ["Each entry is {method, path, status, ms}"];
    return undefined;
  }
  return (v as Record<string, unknown>[]).map((c) => ({ method: c.method as string, path: c.path as string, status: c.status as number, ms: c.ms as number }));
}

export async function postResult(ctx: Ctx, hubId: string, runId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const scenarioId = fromPublic("scn", typeof body.scenarioId === "string" ? body.scenarioId : null);
  if (!scenarioId) fields.scenarioId = ["Must be a scenario id (scn_…)"];
  const verdict = enumField(fields, body, "verdict", ["works", "fails", "skipped", "errored"] as const);
  if (body.verdict === undefined) fields.verdict = ["Required"];
  const failingStep = body.failingStep === undefined || body.failingStep === null ? null : body.failingStep;
  if (failingStep !== null && !int(failingStep, 0, RUN_LIMITS.stepsMax)) fields.failingStep = ["A step number, or null"];
  const message = str(fields, body, "message", { max: RUN_LIMITS.messageMax });
  if (!int(body.durationMs, 0, RUN_LIMITS.durationMax)) fields.durationMs = [`A whole number of milliseconds up to ${RUN_LIMITS.durationMax}`];
  const stepTimings = parseTimings(fields, body.stepTimings);
  const apiCalls = parseApiCalls(fields, body.apiCalls);
  let recording: string | undefined;
  if (body.recording !== undefined) {
    const rec = body.recording;
    if (!isObj(rec) || rec.encoding !== "rrweb+gzip+base64" || typeof rec.events !== "string") {
      fields.recording = ["{encoding: \"rrweb+gzip+base64\", events}"];
    } else if (rec.events.length === 0 || rec.events.length > RUN_LIMITS.recordingMax) {
      fields.recording = [`events: 1 to ${RUN_LIMITS.recordingMax} base64 characters`];
    } else if (!BASE64_RE.test(rec.events)) {
      fields.recording = ["events must be base64"];
    } else {
      recording = rec.events;
    }
  }
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.run.write", async (_repo, runs) => {
    const [run, scenario] = await Promise.all([runs.getRun(ctx.orgId, hubId, runId), runs.getScenario(ctx.orgId, hubId, scenarioId!)]);
    if (!run.ok) return fromRepoError(run.error, ctx.requestId);
    if (!scenario.ok) {
      if (scenario.error.kind === "not_found") return validationError(ctx.requestId, { scenarioId: ["No such scenario in this hub"] });
      return fromRepoError(scenario.error, ctx.requestId);
    }
    if (run.value.status !== "running") return errorResponse("conflict", "That run has already finished", 409, ctx.requestId);
    const at = now(ctx);
    const r = await runs.addResult({
      id: nextId(ctx),
      orgId: ctx.orgId,
      runId,
      scenarioId: scenarioId!,
      featureId: scenario.value.featureId,
      verdict: verdict!,
      failingStep: failingStep as number | null,
      message: message ?? "",
      durationMs: body.durationMs as number,
      stepTimings: stepTimings!,
      apiCalls: apiCalls!,
      createdAt: at,
    });
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    let result = r.value;
    let recordingStored = recording === undefined ? null : false;
    if (recording !== undefined) {
      // A result without its recording is still a result; the caller is told the recording was lost.
      const rec = await runs.addRecording({ id: nextId(ctx), orgId: ctx.orgId, resultId: result.id, events: recording, sizeBytes: Math.floor((recording.length * 3) / 4), createdAt: at });
      if (rec.ok) {
        result = { ...result, recordingId: rec.value.id };
        recordingStored = true;
      }
    }
    return successResponse({ result: publicResult(result), recordingStored }, ctx.requestId, 201);
  });
}

// ── recordings ───────────────────────────────────────────────────────────────

export function getRecording(ctx: Ctx, hubId: string, recordingId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (_repo, runs) => {
    const r = await runs.getRecording(ctx.orgId, hubId, recordingId);
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    const recording: PublicRecording = {
      id: toPublic("rec", r.value.id),
      resultId: toPublic("res", r.value.resultId),
      encoding: r.value.encoding,
      sizeBytes: r.value.sizeBytes,
      events: r.value.events,
    };
    return successResponse({ recording }, ctx.requestId);
  });
}
