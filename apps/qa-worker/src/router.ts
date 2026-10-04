import type { Env } from "./env.js";
import type { Ctx, Deps } from "./handlers.js";
import * as h from "./handlers.js";
import { errorResponse, methodNotAllowed, notFound, successResponse } from "./http.js";
import { fromPublic, generateRequestId, parseOrgPublicId } from "./ids.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;
const BASE = /^\/v1\/organizations\/([^/]+)\/qa\/hubs(?:\/([^/]+)(?:\/(areas|features|map|edges)(?:\/([^/]+)(?:\/(confirm))?)?)?)?$/;

export function isQaPath(pathname: string): boolean {
  return BASE.test(pathname);
}

export function handleHealth(env: Env, requestId: string): Response {
  return successResponse(
    {
      status: "ok",
      service: "qa-worker",
      environment: env.ENVIRONMENT ?? "local",
      timestamp: new Date().toISOString(),
      checks: {
        database: { configured: !!env.PLATFORM_DB },
        membership: { configured: !!env.MEMBERSHIP_WORKER },
        policy: { configured: !!env.POLICY_WORKER },
      },
    },
    requestId,
  );
}

export async function route(request: Request, env: Env, deps?: Deps): Promise<Response> {
  const url = new URL(request.url);
  const header = request.headers.get("x-request-id");
  const requestId = header && REQUEST_ID_RE.test(header) ? header : generateRequestId();

  try {
    if (url.pathname === "/health" && request.method === "GET") return handleHealth(env, requestId);

    const m = url.pathname.match(BASE);
    if (!m) return notFound(requestId, url.pathname);
    const [, orgPub, hubPub, collection, itemPub, verb] = m;

    const orgId = parseOrgPublicId(orgPub!);
    if (!orgId) return errorResponse("not_found", "Not found", 404, requestId);

    const subjectId = request.headers.get("x-actor-subject-id");
    const subjectType = request.headers.get("x-actor-subject-type");
    if (!subjectId || !subjectType) return errorResponse("unauthenticated", "Authentication required", 401, requestId);

    const ctx: Ctx = { env, requestId, actor: { subjectId, subjectType }, orgId, deps };
    const method = request.method;

    if (!hubPub) {
      if (method === "GET") return h.listHubs(ctx);
      if (method === "POST") return h.createHub(ctx, request);
      return methodNotAllowed(requestId);
    }

    const hubId = fromPublic("hub", hubPub);
    if (!hubId) return errorResponse("not_found", "Not found", 404, requestId);

    if (!collection) {
      return method === "GET" ? h.getHub(ctx, hubId) : methodNotAllowed(requestId);
    }

    switch (collection) {
      case "map":
        if (itemPub) return notFound(requestId, url.pathname);
        return method === "GET" ? h.getMap(ctx, hubId) : methodNotAllowed(requestId);

      case "areas":
        if (itemPub) return notFound(requestId, url.pathname);
        if (method === "GET") return h.listAreas(ctx, hubId);
        if (method === "POST") return h.createArea(ctx, hubId, request);
        return methodNotAllowed(requestId);

      case "features": {
        if (verb) return notFound(requestId, url.pathname);
        if (!itemPub) {
          if (method === "GET") return h.listFeatures(ctx, hubId);
          if (method === "POST") return h.createFeature(ctx, hubId, request);
          return methodNotAllowed(requestId);
        }
        const featureId = fromPublic("feat", itemPub);
        if (!featureId) return errorResponse("not_found", "Not found", 404, requestId);
        if (method === "GET") return h.getFeature(ctx, hubId, featureId);
        if (method === "PATCH") return h.updateFeature(ctx, hubId, featureId, request);
        return methodNotAllowed(requestId);
      }

      case "edges": {
        if (!itemPub) return method === "POST" ? h.createEdge(ctx, hubId, request) : methodNotAllowed(requestId);
        const edgeId = fromPublic("edge", itemPub);
        if (!edgeId) return errorResponse("not_found", "Not found", 404, requestId);
        if (verb === "confirm") return method === "POST" ? h.confirmEdge(ctx, hubId, edgeId) : methodNotAllowed(requestId);
        return method === "DELETE" ? h.deleteEdge(ctx, hubId, edgeId) : methodNotAllowed(requestId);
      }

      default:
        return notFound(requestId, url.pathname);
    }
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
