/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { route } from "@qa-worker/router";
import type { Env } from "@qa-worker/env";
import { authorize } from "@saas/policy-engine";
import { createQaRepository, createQaRunsRepository, type QaRepository, type QaRunsRepository } from "@saas/db/qa";
import { ORUN_QA_SELF } from "@saas/contracts/qa-self";
import type { AuthorizationRequest, MembershipFact, TenancyRole } from "@saas/contracts/policy";

// The QA worker end to end: the real router and handlers, the real qa schema in a
// real Postgres engine (PGlite, in-process), and the real policy engine deciding.
// Only the two service bindings are stand-ins, and they answer the way the
// membership and policy workers do.

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_SQL = ["200_qa_feature_map", "210_qa_feature_name_active", "220_qa_scenarios_runs"]
  .map((m) => readFileSync(resolve(__dirname, "../../..", `packages/db/src/migrations/${m}/up.sql`), "utf8"))
  .join("\n");

const ORG_UUID = "11111111-1111-1111-1111-111111111111";
const ORG = "org_11111111111111111111111111111111";
const OTHER_ORG = "org_99999999999999999999999999999999";

async function pgRepos(): Promise<{ repo: QaRepository; runs: QaRunsRepository }> {
  const db = new PGlite();
  await db.exec(QA_SQL);
  // Bind like production: postgres.js with fetch_types off cannot serialize a JS
  // array parameter, so a query that passes one would fail there. PGlite would
  // accept it, so refuse it here. rowCount is the returned rows, as in production.
  type Q = Pick<PGlite, "query">;
  const executorOn = (q: Q) => ({
    async execute(text: string, params?: unknown[]) {
      if ((params ?? []).some((p) => Array.isArray(p))) throw new Error(`array parameter in: ${text.slice(0, 60)}`);
      const r = await q.query<Record<string, unknown>>(text, (params ?? []) as never[]);
      return { rows: r.rows as never[], rowCount: r.rows.length };
    },
  });
  const executor = {
    ...executorOn(db),
    transaction: <T>(fn: (ex: ReturnType<typeof executorOn>) => Promise<T>): Promise<T> => db.transaction((t) => fn(executorOn(t))),
  };
  return { repo: createQaRepository(executor as never), runs: createQaRunsRepository(executor as never) };
}

function fetcher(handle: (body: unknown) => unknown): Fetcher {
  return {
    async fetch(_input: unknown, init?: RequestInit) {
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
      return Response.json({ data: handle(body) });
    },
  } as unknown as Fetcher;
}

/** One Postgres database per test; `role` is the caller's role in ORG (null = not a member). */
async function harness() {
  const repos = await pgRepos();
  const state: { role: TenancyRole | null } = { role: "owner" };
  const env: Env = {
    ENVIRONMENT: "test",
    MEMBERSHIP_WORKER: fetcher((body) => {
      const { orgId } = body as { orgId: string };
      const memberships: MembershipFact[] =
        state.role && orgId === ORG_UUID ? [{ kind: "role_assignment", role: state.role, scope: { kind: "organization", orgId } }] : [];
      return { memberships };
    }),
    POLICY_WORKER: fetcher((body) => authorize(body as AuthorizationRequest)),
  };

  async function call(method: string, path: string, body?: unknown) {
    const res = await route(
      new Request(`https://qa.internal${path}`, {
        method,
        headers: { "x-actor-subject-id": "usr_rahul", "x-actor-subject-type": "user", "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      repos,
    );
    const json = (await res.json()) as { data?: Record<string, any>; error?: { code: string; details?: any } };
    return { status: res.status, ...json };
  }

  return { state, env, call };
}

async function hubWithFeatures(t: Awaited<ReturnType<typeof harness>>, names: string[], hubName = "Orun QA") {
  const hub = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: hubName, stageUrl: "https://stage.orunqa.app" });
  expect(hub.status).toBe(201);
  const hubId = hub.data!.hub.id as string;
  const ids: Record<string, string> = {};
  for (const name of names) {
    const f = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features`, { name });
    expect(f.status).toBe(201);
    ids[name] = f.data!.feature.id;
  }
  return { hubId, ids };
}

describe("qa-worker", () => {
  it("answers /health", async () => {
    const t = await harness();
    const res = await route(new Request("https://qa.internal/health"), t.env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.service).toBe("qa-worker");
  });

  it("requires an actor", async () => {
    const t = await harness();
    const res = await route(new Request(`https://qa.internal/v1/organizations/${ORG}/qa/hubs`), t.env);
    expect(res.status).toBe(401);
  });

  it("creates a hub with a derived slug and lists it", async () => {
    const t = await harness();
    const created = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: "Orun QA", prodUrl: "https://orunqa.app" });
    expect(created.status).toBe(201);
    expect(created.data!.hub).toMatchObject({ name: "Orun QA", slug: "orun-qa", prodUrl: "https://orunqa.app/", orgId: ORG });
    expect(created.data!.hub.id).toMatch(/^hub_[0-9a-f]{32}$/);

    const list = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs`);
    expect(list.data!.hubs).toHaveLength(1);
    const again = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: "Orun QA" });
    expect(again.status).toBe(409);
  });

  it("validates hub input", async () => {
    const t = await harness();
    const bad = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: "", stageUrl: "ftp://x", slug: "Not A Slug" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.error!.details.fields).sort()).toEqual(["name", "slug", "stageUrl"]);
  });

  it("hides another organization's hubs as 404, and a non-member gets 404", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    expect((await t.call("GET", `/v1/organizations/${OTHER_ORG}/qa/hubs/${hubId}`)).status).toBe(404);
    t.state.role = null;
    expect((await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}`)).status).toBe(404);
    expect((await t.call("GET", `/v1/organizations/${ORG}/qa/hubs`)).status).toBe(404);
  });

  it("lets a viewer read but not write; a builder may propose edges but not features", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["Create a project", "Archive a project"]);

    t.state.role = "viewer";
    expect((await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`)).status).toBe(200);
    expect((await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features`, { name: "Task board" })).status).toBe(404);
    expect((await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: "Mine" })).status).toBe(404);

    t.state.role = "builder";
    expect((await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features`, { name: "Task board" })).status).toBe(404);
    const edge = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges`, {
      from: ids["Create a project"], to: ids["Archive a project"], source: "agent",
    });
    expect(edge.status).toBe(201);
    expect(edge.data!.edge.confirmed).toBe(false);
    // Confirming is the PM's call.
    expect((await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges/${edge.data!.edge.id}/confirm`)).status).toBe(404);
    t.state.role = "admin";
    const confirmed = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges/${edge.data!.edge.id}/confirm`);
    expect(confirmed.data!.edge.confirmed).toBe(true);
  });

  it("creates, reads and updates a feature, with areas, refs and a public switch", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    const area = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/areas`, { name: "Projects & tasks", position: 1 });
    expect(area.status).toBe(201);
    const created = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features`, {
      name: "Archive a project",
      description: "Put a finished project away. Its tasks stay readable but locked.",
      areaId: area.data!.area.id,
      codeRefs: ["apps/projects-worker/src/handlers/archive-project.ts"],
      specLinks: ["LIN-498"],
      public: true,
    });
    expect(created.status).toBe(201);
    const f = created.data!.feature;
    expect(f).toMatchObject({ areaId: area.data!.area.id, public: true, health: "not_tested", specLinks: ["LIN-498"] });

    const patched = await t.call("PATCH", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features/${f.id}`, { public: false, qaUserId: "usr_priya" });
    expect(patched.status).toBe(200);
    expect(patched.data!.feature).toMatchObject({ public: false, qaUserId: "usr_priya", name: "Archive a project" });

    const empty = await t.call("PATCH", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features/${f.id}`, {});
    expect(empty.status).toBe(422);
    const badArea = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features`, { name: "X", areaId: "area_" + "0".repeat(32) });
    expect(badArea.status).toBe(422);

    const areas = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/areas`);
    expect(areas.data!.areas.map((a: any) => a.name)).toEqual(["Projects & tasks"]);
  });

  it("draws the map and computes what breaks with a feature", async () => {
    const t = await harness();
    const names = ["Create a project", "Archive a project", "Task board", "Activity feed", "Weekly digest email", "Invoices"];
    const { hubId, ids } = await hubWithFeatures(t, names);
    const edge = (from: string, to: string) =>
      t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges`, { from: ids[from], to: ids[to] });
    expect((await edge("Create a project", "Archive a project")).status).toBe(201);
    expect((await edge("Archive a project", "Task board")).status).toBe(201);
    expect((await edge("Archive a project", "Activity feed")).status).toBe(201);
    expect((await edge("Activity feed", "Weekly digest email")).status).toBe(201);
    expect((await edge("Archive a project", "Archive a project")).status).toBe(422);
    expect((await edge("Archive a project", "Task board")).status).toBe(409);

    const map = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`);
    expect(map.status).toBe(200);
    expect(map.data!.features).toHaveLength(6);
    expect(map.data!.edges).toHaveLength(4);
    expect(map.data!.edges.every((e: any) => e.confirmed && e.source === "human")).toBe(true);

    const archive = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features/${ids["Archive a project"]}`);
    expect(archive.data!.ripple).toEqual({
      feature: ids["Archive a project"],
      reliesOn: [ids["Create a project"]],
      breaksDirectly: [ids["Task board"], ids["Activity feed"]],
      breaksNext: [ids["Weekly digest email"]],
    });

    // Archiving a feature takes it, and its edges, off the map.
    await t.call("PATCH", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features/${ids["Activity feed"]}`, { status: "archived" });
    const after = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`);
    expect(after.data!.features).toHaveLength(5);
    expect(after.data!.edges).toHaveLength(2);
  });

  it("never lets a builder's edge confirm itself, and lets a builder withdraw only unconfirmed edges", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["A", "B", "C"]);
    const base = `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges`;
    const pmEdge = await t.call("POST", base, { from: ids.A, to: ids.B });
    expect(pmEdge.data!.edge.confirmed).toBe(true);

    t.state.role = "builder";
    const mine = await t.call("POST", base, { from: ids.B, to: ids.C });
    expect(mine.status).toBe(201);
    expect(mine.data!.edge.confirmed).toBe(false);
    // A confirmed edge is the PM's to remove; the builder's own proposal can go.
    expect((await t.call("DELETE", `${base}/${pmEdge.data!.edge.id}`)).status).toBe(404);
    expect((await t.call("DELETE", `${base}/${mine.data!.edge.id}`)).status).toBe(200);
  });

  it("validates edits: empty slug means derive, empty name is refused, owner '' clears, position is capped", async () => {
    const t = await harness();
    const hub = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: "Billing Hub", slug: "" });
    expect(hub.status).toBe(201);
    expect(hub.data!.hub.slug).toBe("billing-hub");
    const hubId = hub.data!.hub.id as string;
    const f = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/features`, { name: "Invoices", ownerUserId: "usr_pm" });
    const path = `/v1/organizations/${ORG}/qa/hubs/${hubId}/features/${f.data!.feature.id}`;
    expect((await t.call("PATCH", path, { name: "   " })).status).toBe(422);
    const cleared = await t.call("PATCH", path, { ownerUserId: "" });
    expect(cleared.data!.feature.ownerUserId).toBeNull();
    expect((await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/areas`, { name: "Big", position: 1e12 })).status).toBe(422);
  });

  it("leaves archived features out of a feature's ripple", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["Archive a project", "Activity feed", "Task board"]);
    const base = `/v1/organizations/${ORG}/qa/hubs/${hubId}`;
    await t.call("POST", `${base}/edges`, { from: ids["Archive a project"], to: ids["Activity feed"] });
    await t.call("POST", `${base}/edges`, { from: ids["Archive a project"], to: ids["Task board"] });
    await t.call("PATCH", `${base}/features/${ids["Activity feed"]}`, { status: "archived" });
    const page = await t.call("GET", `${base}/features/${ids["Archive a project"]}`);
    expect(page.data!.ripple.breaksDirectly).toEqual([ids["Task board"]]);
  });

  it("imports Orun QA's own manifest into a hub, idempotently, as the PM", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    const path = `/v1/organizations/${ORG}/qa/hubs/${hubId}/import`;

    const first = await t.call("POST", path, ORUN_QA_SELF);
    expect(first.status).toBe(200);
    expect(first.data!.result).toEqual({
      areas: { created: ORUN_QA_SELF.areas.length, kept: 0 },
      features: { created: ORUN_QA_SELF.features.length, updated: 0, kept: 0 },
      edges: { created: ORUN_QA_SELF.edges.length, confirmed: 0, kept: 0 },
    });
    const map = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`);
    expect(map.data!.features).toHaveLength(ORUN_QA_SELF.features.length);
    expect(map.data!.edges).toHaveLength(ORUN_QA_SELF.edges.length);
    expect(map.data!.edges.every((e: any) => e.confirmed)).toBe(true);
    const insights = map.data!.features.find((f: any) => f.name === "Insights map");
    expect(map.data!.areas.find((a: any) => a.id === insights.areaId)?.name).toBe("The feature map");

    const again = await t.call("POST", path, ORUN_QA_SELF);
    expect(again.data!.result).toEqual({
      areas: { created: 0, kept: ORUN_QA_SELF.areas.length },
      features: { created: 0, updated: 0, kept: ORUN_QA_SELF.features.length },
      edges: { created: 0, confirmed: 0, kept: ORUN_QA_SELF.edges.length },
    });
    const after = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`);
    expect(after.data!.features).toHaveLength(ORUN_QA_SELF.features.length);
  });

  it("confirms a link QA proposed, reuses the hub's areas, and changes only what differs", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["A", "B"]);
    const base = `/v1/organizations/${ORG}/qa/hubs/${hubId}`;
    await t.call("POST", `${base}/areas`, { name: "Existing" });
    t.state.role = "builder";
    const proposed = await t.call("POST", `${base}/edges`, { from: ids.A, to: ids.B });
    expect(proposed.data!.edge.confirmed).toBe(false);
    t.state.role = "owner";
    const r = await t.call("POST", `${base}/import`, {
      areas: [],
      features: [{ name: "A", area: "Existing" }, { name: "B" }],
      edges: [{ from: "A", to: "B" }],
    });
    expect(r.status).toBe(200);
    expect(r.data!.result).toEqual({ areas: { created: 0, kept: 0 }, features: { created: 0, updated: 1, kept: 1 }, edges: { created: 0, confirmed: 1, kept: 0 } });
    const map = await t.call("GET", `${base}/map`);
    expect(map.data!.edges[0].confirmed).toBe(true);
  });

  it("refuses an empty area name, a bad position, and an area that exists nowhere", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    const path = `/v1/organizations/${ORG}/qa/hubs/${hubId}/import`;
    expect((await t.call("POST", path, { areas: [], features: [{ name: "X", area: "" }], edges: [] })).status).toBe(422);
    expect((await t.call("POST", path, { areas: [{ name: "Big", position: -1 }], features: [], edges: [] })).status).toBe(422);
    expect((await t.call("POST", path, { areas: [], features: [{ name: "X", area: "Nowhere" }], edges: [] })).status).toBe(422);
  });

  it("refuses an import from a builder, and a manifest with an unknown edge writes nothing", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    const path = `/v1/organizations/${ORG}/qa/hubs/${hubId}/import`;
    t.state.role = "builder";
    expect((await t.call("POST", path, ORUN_QA_SELF)).status).toBe(404);
    t.state.role = "owner";
    const bad = await t.call("POST", path, { areas: [], features: [{ name: "Only" }], edges: [{ from: "Only", to: "Missing" }] });
    expect(bad.status).toBe(422);
    const map = await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`);
    expect(map.data!.features).toHaveLength(0);
    const dupe = await t.call("POST", path, { areas: [], features: [{ name: "A" }, { name: "a" }], edges: [] });
    expect(dupe.status).toBe(422);
  });

  it("deletes an edge once", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["A", "B"]);
    const e = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges`, { from: ids.A, to: ids.B });
    const path = `/v1/organizations/${ORG}/qa/hubs/${hubId}/edges/${e.data!.edge.id}`;
    expect((await t.call("DELETE", path)).status).toBe(200);
    expect((await t.call("DELETE", path)).status).toBe(404);
  });

  it("refuses unknown methods and paths", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    expect((await t.call("PUT", `/v1/organizations/${ORG}/qa/hubs`)).status).toBe(405);
    expect((await t.call("POST", `/v1/organizations/${ORG}/qa/hubs/${hubId}/map`)).status).toBe(405);
    expect((await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/not-a-hub`)).status).toBe(404);
    expect((await t.call("GET", `/v1/organizations/${ORG}/qa/elsewhere`)).status).toBe(404);
  });

  // ── QA2: scenarios, runs, results, recordings, and health from results ──

  const goodSteps = [
    { text: "Open the features page", action: { type: "goto", path: "/features" } },
    { text: "The map shows", action: { type: "expect_text", text: "Feature map" } },
  ];

  async function approvedScenario(t: Awaited<ReturnType<typeof harness>>, hubId: string, featureId: string, name = "Opens the map") {
    const base = `/v1/organizations/${ORG}/qa/hubs/${hubId}/scenarios`;
    const s = await t.call("POST", base, { featureId, name, steps: goodSteps });
    expect(s.status).toBe(201);
    const id = s.data!.scenario.id as string;
    expect((await t.call("POST", `${base}/${id}/approve`, { updatedAt: s.data!.scenario.updatedAt })).status).toBe(200);
    return id;
  }

  it("writes a scenario as a draft, and only the PM approves it", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["Map"]);
    const base = `/v1/organizations/${ORG}/qa/hubs/${hubId}/scenarios`;
    t.state.role = "builder";
    const s = await t.call("POST", base, { featureId: ids.Map, name: "Opens the map", expected: "The map draws", steps: goodSteps });
    expect(s.status).toBe(201);
    expect(s.data!.scenario.id).toMatch(/^scn_[0-9a-f]{32}$/);
    expect(s.data!.scenario.state).toBe("draft");
    expect(s.data!.scenario.steps.map((x: any) => x.ord)).toEqual([0, 1]);
    const id = s.data!.scenario.id;
    const seen = { updatedAt: s.data!.scenario.updatedAt };
    expect((await t.call("POST", `${base}/${id}/approve`, seen)).status).toBe(404);
    t.state.role = "viewer";
    expect((await t.call("POST", base, { featureId: ids.Map, name: "Other", steps: goodSteps })).status).toBe(404);
    const listed = await t.call("GET", `${base}?feature=${ids.Map}`);
    expect(listed.data!.scenarios).toHaveLength(1);
    t.state.role = "owner";
    expect((await t.call("POST", `${base}/${id}/approve`, {})).status).toBe(422);
    // A builder edits the draft after the PM opened it: the PM's approval is refused.
    t.state.role = "builder";
    const changed = await t.call("PATCH", `${base}/${id}`, { expected: "The map draws every feature" });
    t.state.role = "owner";
    expect((await t.call("POST", `${base}/${id}/approve`, seen)).status).toBe(409);
    const ok = await t.call("POST", `${base}/${id}/approve`, { updatedAt: changed.data!.scenario.updatedAt });
    expect(ok.data!.scenario.state).toBe("approved");
    // Approving it again, unchanged, is a no-op.
    expect((await t.call("POST", `${base}/${id}/approve`, { updatedAt: ok.data!.scenario.updatedAt })).status).toBe(200);
    // A builder cannot take it out of the gate by state, but may change its steps,
    // which sends it back for approval.
    t.state.role = "builder";
    expect((await t.call("PATCH", `${base}/${id}`, { state: "draft" })).status).toBe(404);
    expect((await t.call("PATCH", `${base}/${id}`, { state: "archived" })).status).toBe(404);
    const edited = await t.call("PATCH", `${base}/${id}`, { steps: [goodSteps[0]] });
    expect(edited.data!.scenario.state).toBe("draft");
    expect(edited.data!.scenario.steps).toHaveLength(1);
    t.state.role = "owner";
    // A rename alone does not.
    await t.call("POST", `${base}/${id}/approve`, { updatedAt: edited.data!.scenario.updatedAt });
    const renamed = await t.call("PATCH", `${base}/${id}`, { name: "Opens the feature map" });
    expect(renamed.data!.scenario.state).toBe("approved");
    expect((await t.call("PATCH", `${base}/${id}`, { state: "archived" })).data!.scenario.state).toBe("archived");
    expect((await t.call("PATCH", `${base}/${id}`, { name: "Again" })).status).toBe(409);
  });

  it("validates scenario steps and refuses a feature from elsewhere", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["Map"]);
    const base = `/v1/organizations/${ORG}/qa/hubs/${hubId}/scenarios`;
    const bad = await t.call("POST", base, {
      featureId: ids.Map,
      name: "Bad",
      steps: [
        { text: "", action: { type: "goto", path: "https://evil.example" } },
        { text: "Click", action: { type: "click" } },
        { text: "Eval", action: { type: "evaluate", code: "1" } },
      ],
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.error!.details.fields).sort()).toEqual(["steps.0", "steps.1", "steps.2"]);
    const other = await hubWithFeatures(t, ["Elsewhere"], "Other hub");
    const cross = await t.call("POST", base, { featureId: other.ids.Elsewhere, name: "Cross", steps: goodSteps });
    expect(cross.status).toBe(422);
    const dupe = await t.call("POST", base, { featureId: ids.Map, name: "Same", steps: goodSteps });
    expect(dupe.status).toBe(201);
    expect((await t.call("POST", base, { featureId: ids.Map, name: "same", steps: goodSteps })).status).toBe(409);
  });

  it("records a run: results, a recording, the run's status and the feature's health", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["Map", "Import"]);
    const hub = `/v1/organizations/${ORG}/qa/hubs/${hubId}`;
    const mapScn = await approvedScenario(t, hubId, ids.Map!);
    const importScn = await approvedScenario(t, hubId, ids.Import!, "Imports a manifest");
    // A draft never counts toward health.
    const draft = await t.call("POST", `${hub}/scenarios`, { featureId: ids.Map, name: "Draft one", steps: goodSteps });

    let map = await t.call("GET", `${hub}/map`);
    expect(map.data!.features.map((f: any) => f.health)).toEqual(["not_tested", "not_tested"]);

    t.state.role = "builder"; // the runner signs in as a builder
    const run = await t.call("POST", `${hub}/runs`, { trigger: "deploy", ref: "abc123" });
    expect(run.status).toBe(201);
    expect(run.data!.run.status).toBe("running");
    const runId = run.data!.run.id;
    const events = Buffer.from("not really gzip but base64").toString("base64");
    const works = await t.call("POST", `${hub}/runs/${runId}/results`, {
      scenarioId: mapScn,
      verdict: "works",
      durationMs: 1200,
      stepTimings: [{ ord: 0, startMs: 0, endMs: 600, ok: true }, { ord: 1, startMs: 600, endMs: 1200, ok: true }],
      apiCalls: [{ method: "GET", path: "/v1/organizations/x/qa/hubs/y/map", status: 200, ms: 40 }],
      recording: { encoding: "rrweb+gzip+base64", events },
    });
    expect(works.status).toBe(201);
    expect(works.data!.result.recordingId).toMatch(/^rec_/);
    const fails = await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: importScn, verdict: "fails", failingStep: 1, message: "No text", durationMs: 900 });
    expect(fails.status).toBe(201);
    expect(fails.data!.result.recordingId).toBeNull();
    // A failing step must exist in the scenario, and only a failure names one.
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: importScn, verdict: "fails", failingStep: 2, durationMs: 1 })).status).toBe(422);
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: importScn, verdict: "works", failingStep: 0, durationMs: 1 })).status).toBe(422);
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: importScn, verdict: "works", durationMs: 1, stepTimings: [{ ord: 0, startMs: 9, endMs: 3, ok: true }] })).status).toBe(422);
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: mapScn, verdict: "works", durationMs: 1 })).status).toBe(409);
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: draft.data!.scenario.id, verdict: "works", durationMs: 1 })).status).toBe(201);
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: mapScn, verdict: "works", durationMs: 1, recording: { encoding: "rrweb+gzip+base64", events: "not base64!" } })).status).toBe(422);

    const finished = await t.call("POST", `${hub}/runs/${runId}/finish`, {});
    expect(finished.data!.run.status).toBe("failed");
    expect(finished.data!.run.finishedAt).not.toBeNull();
    expect((await t.call("POST", `${hub}/runs/${runId}/finish`, {})).status).toBe(409);
    expect((await t.call("POST", `${hub}/runs/${runId}/results`, { scenarioId: importScn, verdict: "works", durationMs: 1 })).status).toBe(409);

    t.state.role = "viewer";
    map = await t.call("GET", `${hub}/map`);
    const health = Object.fromEntries(map.data!.features.map((f: any) => [f.name, f.health]));
    expect(health).toEqual({ Map: "verified", Import: "broken" });
    const one = await t.call("GET", `${hub}/features/${ids.Import}`);
    expect(one.data!.feature.health).toBe("broken");

    const rec = await t.call("GET", `${hub}/recordings/${works.data!.result.recordingId}`);
    expect(rec.status).toBe(200);
    expect(rec.data!.recording.events).toBe(events);
    t.state.role = "owner";
    const h2 = await hubWithFeatures(t, [], "Other hub");
    expect((await t.call("GET", `/v1/organizations/${ORG}/qa/hubs/${h2.hubId}/recordings/${works.data!.result.recordingId}`)).status).toBe(404);

    const runs = await t.call("GET", `${hub}/runs`);
    expect(runs.data!.runs).toHaveLength(1);
    const got = await t.call("GET", `${hub}/runs/${runId}`);
    expect(got.data!.results).toHaveLength(3);
    const scn = await t.call("GET", `${hub}/scenarios/${importScn}`);
    expect(scn.data!.scenario.last.verdict).toBe("fails");
    expect(scn.data!.history).toHaveLength(1);

    // A newer passing run makes the feature verified again; quarantine takes a scenario out of the gate.
    const run2 = await t.call("POST", `${hub}/runs`, { trigger: "schedule" });
    await t.call("POST", `${hub}/runs/${run2.data!.run.id}/results`, { scenarioId: importScn, verdict: "works", durationMs: 5 });
    await t.call("POST", `${hub}/runs/${run2.data!.run.id}/finish`, {});
    map = await t.call("GET", `${hub}/map`);
    expect(map.data!.features.map((f: any) => f.health)).toEqual(["verified", "verified"]);
    t.state.role = "builder";
    expect((await t.call("PATCH", `${hub}/scenarios/${mapScn}`, { state: "quarantined" })).status).toBe(404);
    t.state.role = "owner";
    expect((await t.call("PATCH", `${hub}/scenarios/${mapScn}`, { state: "quarantined" })).data!.scenario.state).toBe("quarantined");
    map = await t.call("GET", `${hub}/map`);
    expect(Object.fromEntries(map.data!.features.map((f: any) => [f.name, f.health]))).toEqual({ Map: "not_tested", Import: "verified" });
  });

  it("counts only results since the current approval, and never a try run", async () => {
    const t = await harness();
    const { hubId, ids } = await hubWithFeatures(t, ["Map"]);
    const hub = `/v1/organizations/${ORG}/qa/hubs/${hubId}`;
    const scn = await approvedScenario(t, hubId, ids.Map!);
    const post = async (trigger: string, verdict: string) => {
      const run = await t.call("POST", `${hub}/runs`, { trigger });
      expect((await t.call("POST", `${hub}/runs/${run.data!.run.id}/results`, { scenarioId: scn, verdict, durationMs: 1 })).status).toBe(201);
      return t.call("POST", `${hub}/runs/${run.data!.run.id}/finish`, {});
    };
    const health = async () => (await t.call("GET", `${hub}/map`)).data!.features[0].health;

    expect((await post("schedule", "works")).data!.run.status).toBe("passed");
    expect(await health()).toBe("verified");
    // A developer trying a change that fails does not mark the feature broken.
    await post("try", "fails");
    expect(await health()).toBe("verified");

    // New steps: back to draft, and the old pass no longer speaks for it once re-approved.
    const edited = await t.call("PATCH", `${hub}/scenarios/${scn}`, { steps: [goodSteps[0]] });
    expect(await health()).toBe("not_tested");
    await t.call("POST", `${hub}/scenarios/${scn}/approve`, { updatedAt: edited.data!.scenario.updatedAt });
    expect(await health()).toBe("not_tested");
    expect((await post("deploy", "errored")).data!.run.status).toBe("errored");
    expect(await health()).toBe("attention");

    // A run finished as errored by the runner stays errored; a finished run takes no results.
    const run = await t.call("POST", `${hub}/runs`, { trigger: "manual" });
    expect((await t.call("POST", `${hub}/runs/${run.data!.run.id}/finish`, { errored: true })).data!.run.status).toBe("errored");
    expect((await t.call("POST", `${hub}/runs/${run.data!.run.id}/results`, { scenarioId: scn, verdict: "works", durationMs: 1 })).status).toBe(409);
  });

  it("keeps runs to members who may run them", async () => {
    const t = await harness();
    const { hubId } = await hubWithFeatures(t, []);
    const hub = `/v1/organizations/${ORG}/qa/hubs/${hubId}`;
    t.state.role = "viewer";
    expect((await t.call("POST", `${hub}/runs`, { trigger: "manual" })).status).toBe(404);
    t.state.role = null;
    expect((await t.call("GET", `${hub}/runs`)).status).toBe(404);
    t.state.role = "owner";
    expect((await t.call("POST", `${hub}/runs`, {})).status).toBe(422);
    expect((await t.call("GET", `${hub}/runs?limit=500`)).status).toBe(422);
    expect((await t.call("GET", `${hub}/runs/run_00000000000000000000000000000000`)).status).toBe(404);
    expect((await t.call("GET", `${hub}/runs/not-a-run`)).status).toBe(404);
    expect((await t.call("POST", `${hub}/runs/run_00000000000000000000000000000000/rerun`)).status).toBe(404);
  });
});
