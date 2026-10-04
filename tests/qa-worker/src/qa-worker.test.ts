/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { route } from "@qa-worker/router";
import type { Env } from "@qa-worker/env";
import { authorize } from "@saas/policy-engine";
import { createQaRepository, type QaRepository } from "@saas/db/qa";
import type { AuthorizationRequest, MembershipFact, TenancyRole } from "@saas/contracts/policy";

// The QA worker end to end: the real router and handlers, the real qa schema in a
// real Postgres engine (PGlite, in-process), and the real policy engine deciding.
// Only the two service bindings are stand-ins, and they answer the way the
// membership and policy workers do.

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_SQL = readFileSync(resolve(__dirname, "../../..", "packages/db/src/migrations/200_qa_feature_map/up.sql"), "utf8");

const ORG_UUID = "11111111-1111-1111-1111-111111111111";
const ORG = "org_11111111111111111111111111111111";
const OTHER_ORG = "org_99999999999999999999999999999999";

async function pgRepo(): Promise<QaRepository> {
  const db = new PGlite();
  await db.exec(QA_SQL);
  return createQaRepository({
    async execute(text: string, params?: unknown[]) {
      const r = await db.query<Record<string, unknown>>(text, (params ?? []) as never[]);
      return { rows: r.rows as never[], rowCount: r.rows.length };
    },
  });
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
  const repo = await pgRepo();
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
      { repo },
    );
    const json = (await res.json()) as { data?: Record<string, any>; error?: { code: string; details?: any } };
    return { status: res.status, ...json };
  }

  return { state, env, call };
}

async function hubWithFeatures(t: Awaited<ReturnType<typeof harness>>, names: string[]) {
  const hub = await t.call("POST", `/v1/organizations/${ORG}/qa/hubs`, { name: "Orun QA", stageUrl: "https://stage.orunqa.app" });
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
});
