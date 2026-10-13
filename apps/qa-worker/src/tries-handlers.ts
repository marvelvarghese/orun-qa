import type { Try } from "@saas/db/qa";
import { RUN_LIMITS, TRY_LIMITS, type PublicTry, type StepAction, type TryAnswer, type TryRole } from "@saas/contracts/qa";
import { errorResponse, successResponse, validationError } from "./http.js";
import { fromPublic, toPublic } from "./ids.js";
import { fromRepoError, nextId, now, readJson, str, withRepo, type Ctx, type Fields } from "./handlers.js";
import { BASE64_RE, base64Bytes, enumField, parseApiCalls, parseSteps, parseTimings, publicScenario, stepIds } from "./runs-handlers.js";

/**
 * Try a scenario (QA2). A person asks a plain question; the runner's AI tries
 * it once on stage in a real browser and answers with the steps it took, the
 * API calls it saw and a recording. Nothing becomes a scenario unless the
 * person saves it — then it is a draft, approved like any other.
 */

export function publicTry(t: Try): PublicTry {
  return {
    id: toPublic("try", t.id),
    hubId: toPublic("hub", t.hubId),
    featureId: t.featureId ? toPublic("feat", t.featureId) : null,
    question: t.question,
    asRole: t.asRole,
    status: t.status,
    answer: t.answer,
    headline: t.headline,
    explanation: t.explanation,
    steps: t.steps.map((s) => ({ text: s.text, action: s.action as unknown as StepAction })),
    stepTimings: t.stepTimings,
    apiCalls: t.apiCalls,
    hasRecording: t.hasRecording,
    message: t.message,
    savedScenarioId: t.savedScenarioId ? toPublic("scn", t.savedScenarioId) : null,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    finishedAt: t.finishedAt ? t.finishedAt.toISOString() : null,
  };
}

/**
 * Start the try workflow now rather than at the runner's next pass. Best
 * effort: without a token, or if GitHub refuses, the try simply waits. Only the
 * workspace the runner serves (GITHUB_TRY_ORG) dispatches — the runner answers
 * no one else's tries.
 */
async function dispatch(ctx: Ctx, tryId: string): Promise<boolean> {
  const { GITHUB_DISPATCH_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_TRY_WORKFLOW: workflow, GITHUB_TRY_ORG: servedOrg } = ctx.env;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return false;
  if (!servedOrg || servedOrg !== toPublic("org", ctx.orgId)) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow || "qa-try.yml")}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "orun-qa-worker",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { try_id: tryId } }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export async function createTry(ctx: Ctx, hubId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const question = str(fields, body, "question", { required: true, max: TRY_LIMITS.questionMax });
  const asRole = enumField(fields, body, "asRole", ["owner", "visitor"] as const);
  let featureId: string | null = null;
  if (body.featureId !== undefined && body.featureId !== null) {
    featureId = fromPublic("feat", typeof body.featureId === "string" ? body.featureId : null);
    if (!featureId) fields.featureId = ["Must be a feature id (feat_…) or null"];
  }
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  let created: { id: string; othersWaiting: boolean } | null = null;
  const response = await withRepo(ctx, "qa.run.write", async (repo, _runs, tries) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await tries.createTry({
      id: nextId(ctx),
      orgId: ctx.orgId,
      hubId,
      featureId,
      question: question!,
      asRole: (asRole ?? "owner") as TryRole,
      // eslint-disable-next-line no-restricted-syntax -- qa created_by is TEXT holding the public actor id, like qa.feature_edges.confirmed_by
      createdBy: ctx.actor.subjectId,
      createdAt: now(ctx),
    });
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    const waiting = await tries.hasActiveTry(ctx.orgId, hubId, r.value.id);
    created = { id: toPublic("try", r.value.id), othersWaiting: waiting.ok && waiting.value };
    return successResponse({ try: publicTry(r.value) }, ctx.requestId, 201);
  });
  if (!created || response.status !== 201) return response;
  const made: { id: string; othersWaiting: boolean } = created;
  // After the database is let go: one job answers every waiting try, so a try
  // asked while others wait rides along with the job already started for them.
  const dispatched = made.othersWaiting ? false : await dispatch(ctx, made.id);
  const sent = (await response.json()) as { data: { try: PublicTry }; meta: unknown };
  return Response.json({ ...sent, data: { ...sent.data, dispatched, queuedBehind: made.othersWaiting } }, { status: 201, headers: { "content-type": "application/json" } });
}

export function listTries(ctx: Ctx, hubId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (repo, _runs, tries) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await tries.listTries(ctx.orgId, hubId, ctx.actor.subjectId, TRY_LIMITS.recentMax);
    return r.ok ? successResponse({ tries: r.value.map(publicTry) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export function getTry(ctx: Ctx, hubId: string, tryId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (_repo, _runs, tries) => {
    const r = await tries.getTry(ctx.orgId, hubId, tryId);
    return r.ok ? successResponse({ try: publicTry(r.value) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export function getTryRecording(ctx: Ctx, hubId: string, tryId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (_repo, _runs, tries) => {
    const r = await tries.getTryRecording(ctx.orgId, hubId, tryId);
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    return successResponse({ recording: { encoding: "rrweb+gzip+base64", events: r.value } }, ctx.requestId);
  });
}

/** The runner takes the oldest queued try; 200 with null when there is none. */
export function claimTry(ctx: Ctx, hubId: string): Promise<Response> {
  return withRepo(ctx, "qa.run.write", async (_repo, _runs, tries) => {
    const at = now(ctx);
    const r = await tries.claimTry(ctx.orgId, hubId, ctx.actor.subjectId, at, new Date(at.getTime() - TRY_LIMITS.staleAfterMs));
    if (!r.ok) return fromRepoError(r.error, ctx.requestId);
    return successResponse({ try: r.value ? publicTry(r.value) : null }, ctx.requestId);
  });
}

export async function postTryResult(ctx: Ctx, hubId: string, tryId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const error = str(fields, body, "error", { max: RUN_LIMITS.messageMax });
  if (error) {
    if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);
    return withRepo(ctx, "qa.run.write", async (_repo, _runs, tries) => {
      const r = await tries.failTry(ctx.orgId, hubId, tryId, ctx.actor.subjectId, error, now(ctx));
      if (!r.ok && r.error.kind === "conflict") return errorResponse("conflict", "That try is not running for you", 409, ctx.requestId);
      return r.ok ? successResponse({ try: publicTry(r.value) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
    });
  }
  const answer = enumField(fields, body, "answer", ["yes", "no", "unclear"] as const);
  if (body.answer === undefined) fields.answer = ["Required"];
  const headline = str(fields, body, "headline", { required: true, max: TRY_LIMITS.headlineMax });
  const explanation = str(fields, body, "explanation", { max: TRY_LIMITS.explanationMax });
  const steps = parseSteps(fields, body, true);
  const stepTimings = parseTimings(fields, body.stepTimings);
  const apiCalls = parseApiCalls(fields, body.apiCalls);
  let recording: string | undefined;
  if (body.recording !== undefined) {
    const rec = body.recording as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object" || rec.encoding !== "rrweb+gzip+base64" || typeof rec.events !== "string") fields.recording = ['{encoding: "rrweb+gzip+base64", events}'];
    else if (rec.events.length === 0 || rec.events.length > RUN_LIMITS.recordingMax) fields.recording = [`events: 1 to ${RUN_LIMITS.recordingMax} base64 characters`];
    else if (rec.events.length % 4 !== 0 || !BASE64_RE.test(rec.events)) fields.recording = ["events must be base64"];
    else recording = rec.events;
  }
  if (steps && stepTimings && stepTimings.some((t) => t.ord >= steps.length)) fields.stepTimings = [`This try has ${steps.length} steps`];
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.run.write", async (_repo, _runs, tries) => {
    const r = await tries.answerTry(ctx.orgId, hubId, tryId, ctx.actor.subjectId, {
      answer: answer as TryAnswer,
      headline: headline!,
      explanation: explanation ?? "",
      steps: steps!.map((s) => ({ text: s.text, action: s.action })),
      stepTimings: stepTimings!,
      apiCalls: apiCalls!,
      recording: recording === undefined ? null : { events: recording, sizeBytes: base64Bytes(recording) },
      at: now(ctx),
    });
    if (!r.ok && r.error.kind === "conflict") return errorResponse("conflict", "That try is not running for you", 409, ctx.requestId);
    return r.ok ? successResponse({ try: publicTry(r.value) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

/** Keep an answered try as a draft scenario of a feature, with exactly the steps it took. */
export async function saveTry(ctx: Ctx, hubId: string, tryId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const featureId = fromPublic("feat", typeof body.featureId === "string" ? body.featureId : null);
  if (!featureId) fields.featureId = ["Must be a feature id (feat_…)"];
  const name = str(fields, body, "name", { required: true, max: 120 });
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.scenario.write", async (_repo, runs, tries) => {
    const t = await tries.getTry(ctx.orgId, hubId, tryId);
    if (!t.ok) return fromRepoError(t.error, ctx.requestId);
    if (t.value.status !== "answered" || t.value.steps.length === 0) return errorResponse("conflict", "Only an answered try can be saved", 409, ctx.requestId);
    // Claim the save first, so two saves at once make one scenario.
    const scenarioId = nextId(ctx);
    const claimed = await tries.markSaved(ctx.orgId, hubId, tryId, scenarioId);
    if (!claimed.ok) {
      if (claimed.error.kind === "conflict") return errorResponse("conflict", "This try is already saved as a scenario", 409, ctx.requestId);
      return fromRepoError(claimed.error, ctx.requestId);
    }
    const steps = t.value.steps.map((s, i) => ({ ord: i, text: s.text, action: s.action }));
    const created = await runs.createScenario({
      id: scenarioId,
      orgId: ctx.orgId,
      hubId,
      featureId: featureId!,
      name: name!,
      expected: t.value.headline,
      kind: steps.some((s) => s.action.type !== "expect_response") ? "screens_apis" : "api_only",
      cadence: "daily",
      asRole: t.value.asRole === "visitor" ? "visitor" : null,
      // eslint-disable-next-line no-restricted-syntax -- qa created_by is TEXT holding the public actor id, like qa.feature_edges.confirmed_by
      createdBy: ctx.actor.subjectId,
      steps,
      stepIds: stepIds(ctx, steps),
      createdAt: now(ctx),
    });
    if (!created.ok) {
      await tries.clearSaved(ctx.orgId, hubId, tryId, scenarioId);
      if (created.error.kind === "conflict") return errorResponse("conflict", "A scenario of that feature already has this name", 409, ctx.requestId);
      return fromRepoError(created.error, ctx.requestId);
    }
    return successResponse({ try: publicTry(claimed.value), scenario: publicScenario(created.value, undefined) }, ctx.requestId, 201);
  });
}
