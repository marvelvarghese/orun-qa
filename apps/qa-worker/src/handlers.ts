import type { Env } from "./env.js";
import type { QaRepository, QaRepositoryError, Hub, Area, Feature, FeatureEdge } from "@saas/db/qa";
import { createQaRepository } from "@saas/db/qa";
import { createSqlExecutor } from "@saas/db/hyperdrive";
import {
  QA_LIMITS,
  computeRipple,
  type PublicArea,
  type PublicFeature,
  type PublicFeatureEdge,
  type PublicHub,
} from "@saas/contracts/qa";
import { fetchAuthorizationContext } from "./membership-client.js";
import { authorizeViaPolicy } from "./policy-client.js";
import { errorResponse, successResponse, validationError } from "./http.js";
import { fromPublic, newUuid, toPublic } from "./ids.js";

export interface ActorContext {
  subjectId: string;
  subjectType: string;
}

/** Test seams: a repository double, a clock and an id source. */
export interface Deps {
  repo?: QaRepository;
  now?: () => Date;
  newId?: () => string;
}

export interface Ctx {
  env: Env;
  requestId: string;
  actor: ActorContext;
  orgId: string;
  deps?: Deps | undefined;
}

type Fields = Record<string, string[]>;

// ── public shapes ────────────────────────────────────────────────────────────

export function publicHub(h: Hub): PublicHub {
  return {
    id: toPublic("hub", h.id),
    orgId: toPublic("org", h.orgId),
    name: h.name,
    slug: h.slug,
    stageUrl: h.stageUrl,
    prodUrl: h.prodUrl,
    orunbaseWorkspace: h.orunbaseWorkspace,
    createdAt: h.createdAt.toISOString(),
  };
}

export function publicArea(a: Area): PublicArea {
  return { id: toPublic("area", a.id), hubId: toPublic("hub", a.hubId), name: a.name, position: a.position };
}

export function publicFeature(f: Feature): PublicFeature {
  return {
    id: toPublic("feat", f.id),
    hubId: toPublic("hub", f.hubId),
    areaId: f.areaId ? toPublic("area", f.areaId) : null,
    name: f.name,
    description: f.description,
    ownerUserId: f.ownerUserId,
    qaUserId: f.qaUserId,
    public: f.isPublic,
    codeRefs: f.codeRefs,
    specLinks: f.specLinks,
    // QA1 has no runner yet: nothing has been verified. QA2 derives this from results.
    health: "not_tested",
    status: f.status,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function publicEdge(e: FeatureEdge): PublicFeatureEdge {
  return {
    id: toPublic("edge", e.id),
    from: toPublic("feat", e.fromFeatureId),
    to: toPublic("feat", e.toFeatureId),
    source: e.source,
    confirmed: e.confirmedAt !== null,
  };
}

// ── plumbing ─────────────────────────────────────────────────────────────────

function unavailable(requestId: string): Response {
  return errorResponse("internal_error", "Service unavailable", 503, requestId);
}

function notFound(requestId: string): Response {
  return errorResponse("not_found", "Not found", 404, requestId);
}

function fromRepoError(err: QaRepositoryError, requestId: string): Response {
  switch (err.kind) {
    case "not_found":
      return notFound(requestId);
    case "conflict":
      return errorResponse("conflict", `That ${err.entity} already exists`, 409, requestId, { entity: err.entity });
    case "invalid":
      return validationError(requestId, { body: [err.reason] });
    default:
      return unavailable(requestId);
  }
}

/** Deny is always 404: a caller outside the organization learns nothing about it. */
async function allowed(ctx: Ctx, action: string): Promise<boolean> {
  const { env, actor, orgId, requestId } = ctx;
  const membership = await fetchAuthorizationContext(env.MEMBERSHIP_WORKER!, actor.subjectId, actor.subjectType, orgId, requestId);
  if (!membership.ok) return false;
  const decision = await authorizeViaPolicy(
    env.POLICY_WORKER!,
    actor.subjectId,
    actor.subjectType,
    action,
    { kind: "organization", orgId },
    membership.memberships,
    requestId,
  );
  return decision.allow;
}

async function withRepo(ctx: Ctx, action: string, fn: (repo: QaRepository) => Promise<Response>): Promise<Response> {
  const { env, requestId, deps } = ctx;
  if (!env.MEMBERSHIP_WORKER || !env.POLICY_WORKER) return unavailable(requestId);
  if (!deps?.repo && !env.PLATFORM_DB) return unavailable(requestId);
  if (!(await allowed(ctx, action))) return notFound(requestId);
  if (deps?.repo) return fn(deps.repo);
  const executor = createSqlExecutor(env.PLATFORM_DB!);
  try {
    return await fn(createQaRepository(executor));
  } catch {
    return unavailable(requestId);
  } finally {
    await executor.dispose();
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const now = (ctx: Ctx) => (ctx.deps?.now ?? (() => new Date()))();
const nextId = (ctx: Ctx) => (ctx.deps?.newId ?? newUuid)();

function str(fields: Fields, body: Record<string, unknown>, key: string, opts: { required?: boolean; max: number }): string | undefined {
  const v = body[key];
  if (v === undefined || v === null) {
    if (opts.required) (fields[key] ??= []).push("Required");
    return undefined;
  }
  if (typeof v !== "string") {
    (fields[key] ??= []).push("Must be a string");
    return undefined;
  }
  const t = v.trim();
  if (opts.required && t.length === 0) (fields[key] ??= []).push("Must not be empty");
  if (t.length > opts.max) (fields[key] ??= []).push(`At most ${opts.max} characters`);
  return t;
}

function strList(fields: Fields, body: Record<string, unknown>, key: string): string[] | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > QA_LIMITS.refMax)) {
    (fields[key] ??= []).push(`Must be a list of strings of at most ${QA_LIMITS.refMax} characters`);
    return undefined;
  }
  if (v.length > QA_LIMITS.refsMax) (fields[key] ??= []).push(`At most ${QA_LIMITS.refsMax} entries`);
  return (v as string[]).map((x) => x.trim()).filter((x) => x.length > 0);
}

function optUrl(fields: Fields, body: Record<string, unknown>, key: string): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") {
    (fields[key] ??= []).push("Must be a URL");
    return undefined;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    return u.toString();
  } catch {
    (fields[key] ??= []).push("Must be an http(s) URL");
    return undefined;
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "hub";
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// ── hubs ─────────────────────────────────────────────────────────────────────

export function listHubs(ctx: Ctx): Promise<Response> {
  return withRepo(ctx, "qa.hub.read", async (repo) => {
    const r = await repo.listHubs(ctx.orgId);
    return r.ok ? successResponse({ hubs: r.value.map(publicHub) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export async function createHub(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const name = str(fields, body, "name", { required: true, max: QA_LIMITS.nameMax });
  const slugRaw = str(fields, body, "slug", { max: 63 });
  const slugIn = slugRaw === "" ? undefined : slugRaw;
  const stageUrl = optUrl(fields, body, "stageUrl");
  const prodUrl = optUrl(fields, body, "prodUrl");
  const slug = slugIn ?? (name ? slugify(name) : "");
  // A slug the caller gave is always checked; a derived one only once there is a name to derive from.
  if ((slugIn !== undefined || name) && !SLUG_RE.test(slug)) (fields.slug ??= []).push("Lowercase letters, digits and dashes");
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.hub.manage", async (repo) => {
    const r = await repo.createHub({
      id: nextId(ctx),
      orgId: ctx.orgId,
      name: name!,
      slug,
      stageUrl: stageUrl ?? null,
      prodUrl: prodUrl ?? null,
      createdAt: now(ctx),
    });
    return r.ok ? successResponse({ hub: publicHub(r.value) }, ctx.requestId, 201) : fromRepoError(r.error, ctx.requestId);
  });
}

export function getHub(ctx: Ctx, hubId: string): Promise<Response> {
  return withRepo(ctx, "qa.hub.read", async (repo) => {
    const r = await repo.getHub(ctx.orgId, hubId);
    return r.ok ? successResponse({ hub: publicHub(r.value) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

// ── areas ────────────────────────────────────────────────────────────────────

export function listAreas(ctx: Ctx, hubId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (repo) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await repo.listAreas(ctx.orgId, hubId);
    return r.ok ? successResponse({ areas: r.value.map(publicArea) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export async function createArea(ctx: Ctx, hubId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const name = str(fields, body, "name", { required: true, max: QA_LIMITS.nameMax });
  const position = body.position === undefined ? 0 : body.position;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position > QA_LIMITS.positionMax) {
    (fields.position ??= []).push(`A whole number from 0 to ${QA_LIMITS.positionMax}`);
  }
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.feature.write", async (repo) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await repo.createArea({ id: nextId(ctx), orgId: ctx.orgId, hubId, name: name!, position: position as number, createdAt: now(ctx) });
    return r.ok ? successResponse({ area: publicArea(r.value) }, ctx.requestId, 201) : fromRepoError(r.error, ctx.requestId);
  });
}

// ── features ─────────────────────────────────────────────────────────────────

interface FeatureFields {
  name?: string | undefined;
  description?: string | undefined;
  areaId?: string | null | undefined;
  ownerUserId?: string | null | undefined;
  qaUserId?: string | null | undefined;
  isPublic?: boolean | undefined;
  codeRefs?: string[] | undefined;
  specLinks?: string[] | undefined;
  status?: "active" | "archived" | undefined;
}

function parseFeatureBody(body: Record<string, unknown>, creating: boolean): { ok: true; value: FeatureFields } | { ok: false; fields: Fields } {
  const fields: Fields = {};
  const value: FeatureFields = {};
  value.name = str(fields, body, "name", { required: creating, max: QA_LIMITS.nameMax });
  if (!creating && value.name !== undefined && value.name.length === 0) (fields.name ??= []).push("Must not be empty");
  value.description = str(fields, body, "description", { max: QA_LIMITS.descriptionMax });
  if (body.areaId !== undefined) {
    if (body.areaId === null) value.areaId = null;
    else {
      const a = fromPublic("area", typeof body.areaId === "string" ? body.areaId : null);
      if (!a) (fields.areaId ??= []).push("Must be an area id (area_…) or null");
      else value.areaId = a;
    }
  }
  for (const key of ["ownerUserId", "qaUserId"] as const) {
    if (body[key] === null) value[key] = null;
    else {
      const v = str(fields, body, key, { max: 128 });
      if (v !== undefined) value[key] = v === "" ? null : v;
    }
  }
  if (body.public !== undefined) {
    if (typeof body.public !== "boolean") (fields.public ??= []).push("Must be true or false");
    else value.isPublic = body.public;
  }
  value.codeRefs = strList(fields, body, "codeRefs");
  value.specLinks = strList(fields, body, "specLinks");
  if (!creating && body.status !== undefined) {
    if (body.status !== "active" && body.status !== "archived") (fields.status ??= []).push("active or archived");
    else value.status = body.status;
  }
  if (!creating && Object.values(value).every((v) => v === undefined)) fields.body = ["Nothing to update"];
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export function listFeatures(ctx: Ctx, hubId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (repo) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await repo.listFeatures(ctx.orgId, hubId);
    return r.ok ? successResponse({ features: r.value.map(publicFeature) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export async function createFeature(ctx: Ctx, hubId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const parsed = parseFeatureBody(body, true);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const v = parsed.value;

  return withRepo(ctx, "qa.feature.write", async (repo) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const r = await repo.createFeature({
      id: nextId(ctx),
      orgId: ctx.orgId,
      hubId,
      areaId: v.areaId ?? null,
      name: v.name!,
      description: v.description ?? "",
      ownerUserId: v.ownerUserId ?? null,
      qaUserId: v.qaUserId ?? null,
      isPublic: v.isPublic ?? false,
      codeRefs: v.codeRefs ?? [],
      specLinks: v.specLinks ?? [],
      createdAt: now(ctx),
    });
    return r.ok ? successResponse({ feature: publicFeature(r.value) }, ctx.requestId, 201) : fromRepoError(r.error, ctx.requestId);
  });
}

export function getFeature(ctx: Ctx, hubId: string, featureId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (repo) => {
    const [feature, edges, active] = await Promise.all([
      repo.getFeature(ctx.orgId, hubId, featureId),
      repo.listEdges(ctx.orgId, hubId),
      repo.listFeatures(ctx.orgId, hubId),
    ]);
    if (!feature.ok) return fromRepoError(feature.error, ctx.requestId);
    if (!edges.ok) return fromRepoError(edges.error, ctx.requestId);
    if (!active.ok) return fromRepoError(active.error, ctx.requestId);
    const pub = publicFeature(feature.value);
    // Same rule as the map: an archived feature, and its edges, are off the map.
    const live = new Set(active.value.map((f) => f.id));
    const ripple = computeRipple(pub.id, edges.value.filter((e) => live.has(e.fromFeatureId) && live.has(e.toFeatureId)).map(publicEdge));
    return successResponse({ feature: pub, ripple }, ctx.requestId);
  });
}

export async function updateFeature(ctx: Ctx, hubId: string, featureId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const parsed = parseFeatureBody(body, false);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);

  return withRepo(ctx, "qa.feature.write", async (repo) => {
    const r = await repo.updateFeature(ctx.orgId, hubId, featureId, { ...parsed.value, updatedAt: now(ctx) });
    return r.ok ? successResponse({ feature: publicFeature(r.value) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

// ── the map and its edges ────────────────────────────────────────────────────

export function getMap(ctx: Ctx, hubId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.read", async (repo) => {
    const hub = await repo.getHub(ctx.orgId, hubId);
    if (!hub.ok) return fromRepoError(hub.error, ctx.requestId);
    const [areas, features, edges] = await Promise.all([
      repo.listAreas(ctx.orgId, hubId),
      repo.listFeatures(ctx.orgId, hubId),
      repo.listEdges(ctx.orgId, hubId),
    ]);
    if (!areas.ok) return fromRepoError(areas.error, ctx.requestId);
    if (!features.ok) return fromRepoError(features.error, ctx.requestId);
    if (!edges.ok) return fromRepoError(edges.error, ctx.requestId);
    const live = new Set(features.value.map((f) => f.id));
    return successResponse(
      {
        hub: publicHub(hub.value),
        areas: areas.value.map(publicArea),
        features: features.value.map(publicFeature),
        // An archived feature leaves the map, and so do its edges.
        edges: edges.value.filter((e) => live.has(e.fromFeatureId) && live.has(e.toFeatureId)).map(publicEdge),
      },
      ctx.requestId,
    );
  });
}

export async function createEdge(ctx: Ctx, hubId: string, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return validationError(ctx.requestId, { body: ["Request body must be a JSON object"] });
  const fields: Fields = {};
  const from = fromPublic("feat", typeof body.from === "string" ? body.from : null);
  const to = fromPublic("feat", typeof body.to === "string" ? body.to : null);
  if (!from) fields.from = ["Must be a feature id (feat_…)"];
  if (!to) fields.to = ["Must be a feature id (feat_…)"];
  const source = body.source === undefined ? "human" : body.source;
  if (source !== "human" && source !== "agent") fields.source = ["human or agent"];
  if (from && to && from === to) fields.to = ["A feature cannot depend on itself"];
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepo(ctx, "qa.map.write", async (repo) => {
    // A person's edge confirms itself only when that person may confirm (the PM).
    // A builder's edge, like an agent's, waits for confirmation.
    const confirms = source === "human" && (await allowed(ctx, "qa.feature.write"));
    const r = await repo.createEdge({
      id: nextId(ctx),
      orgId: ctx.orgId,
      hubId,
      fromFeatureId: from!,
      toFeatureId: to!,
      source: source as "human" | "agent",
      confirmedBy: confirms ? ctx.actor.subjectId : null,
      createdAt: now(ctx),
    });
    return r.ok ? successResponse({ edge: publicEdge(r.value) }, ctx.requestId, 201) : fromRepoError(r.error, ctx.requestId);
  });
}

export function confirmEdge(ctx: Ctx, hubId: string, edgeId: string): Promise<Response> {
  return withRepo(ctx, "qa.feature.write", async (repo) => {
    const r = await repo.confirmEdge(ctx.orgId, hubId, edgeId, ctx.actor.subjectId, now(ctx));
    return r.ok ? successResponse({ edge: publicEdge(r.value) }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}

export function deleteEdge(ctx: Ctx, hubId: string, edgeId: string): Promise<Response> {
  return withRepo(ctx, "qa.map.write", async (repo) => {
    // The PM removes any edge; anyone who may propose edges may withdraw one that
    // is still unconfirmed. A confirmed edge is the PM's to remove.
    if (!(await allowed(ctx, "qa.feature.write"))) {
      const edges = await repo.listEdges(ctx.orgId, hubId);
      if (!edges.ok) return fromRepoError(edges.error, ctx.requestId);
      const edge = edges.value.find((e) => e.id === edgeId);
      if (!edge || edge.confirmedAt !== null) return notFound(ctx.requestId);
    }
    const r = await repo.deleteEdge(ctx.orgId, hubId, edgeId);
    return r.ok ? successResponse({ deleted: true }, ctx.requestId) : fromRepoError(r.error, ctx.requestId);
  });
}
