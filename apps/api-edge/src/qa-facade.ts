import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

// Orun QA: /v1/organizations/{org}/qa/hubs[/{hub}[/{collection}[/{id}[/{verb}]]]]
const QA_RE = /^\/v1\/organizations\/[^/]+\/qa\/hubs(?:\/[^/]+(?:\/(?:areas|features|map|edges|import|scenarios|runs|recordings)(?:\/[^/]+(?:\/(?:confirm|approve|finish|results))?)?)?)?$/;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const WITH_BODY = new Set(["POST", "PATCH"]);
const FORWARDED_HEADERS = ["content-type", "traceparent", "idempotency-key"];

export function isQaRoute(pathname: string): boolean {
  return QA_RE.test(pathname);
}

export async function handleQaRoute(request: Request, env: Env, requestId: string, pathname: string): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  return replayOrExecute(request, requestId, env, "qa", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    if (!env.QA_WORKER) {
      return errorResponse("internal_error", "QA service unavailable", 503, requestId);
    }

    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const session = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in session) return session.error;

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", session.subjectId);
    headers.set("x-actor-subject-type", session.subjectType);
    headers.set("x-actor-email", session.email);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://qa.internal");
    const init: RequestInit = { method: request.method, headers };
    if (WITH_BODY.has(request.method)) init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () => env.QA_WORKER!.fetch(target.toString(), init));
      const res = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.qa", timings);
    } catch {
      return errorResponse("internal_error", "QA service unavailable", 503, requestId);
    }
  });
}
