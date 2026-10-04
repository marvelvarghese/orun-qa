import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlExecutor } from "@saas/db/hyperdrive";
import { createQaRepository, type QaRepository } from "@saas/db/qa";
import { manifest, BOUNDED_CONTEXTS } from "@saas/db";

// Orun QA (QA1): the qa schema migration and repository against a REAL Postgres
// engine (PGlite, in-process). The other suites here stub the executor and assert
// SQL text; this one proves Postgres accepts the SQL and the constraints hold.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const QA_SQL = readFileSync(resolve(MIGRATIONS_ROOT, "200_qa_feature_map/up.sql"), "utf8");

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(QA_SQL);
  return db;
}

function executorOver(db: PGlite): SqlExecutor {
  return {
    async execute(text: string, params?: unknown[]) {
      const r = await db.query<Record<string, unknown>>(text, (params ?? []) as never[]);
      return { rows: r.rows as never[], rowCount: r.rows.length };
    },
  };
}

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "99999999-9999-9999-9999-999999999999";
const AT = new Date("2026-10-04T10:00:00.000Z");
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function seedHub(repo: QaRepository, org = ORG, slug = "orun-qa") {
  const r = await repo.createHub({ id: id(), orgId: org, name: "Orun QA", slug, stageUrl: null, prodUrl: null, createdAt: AT });
  if (!r.ok) throw new Error(`hub ${JSON.stringify(r.error)}`);
  return r.value;
}

async function seedFeature(repo: QaRepository, hubId: string, name: string) {
  const r = await repo.createFeature({
    id: id(), orgId: ORG, hubId, areaId: null, name, description: "", ownerUserId: null, qaUserId: null,
    isPublic: false, codeRefs: [], specLinks: [], createdAt: AT,
  });
  if (!r.ok) throw new Error(`feature ${name}: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("200_qa_feature_map migration", () => {
  it("registers 'qa' as a bounded context and sits at the manifest tail", () => {
    expect(BOUNDED_CONTEXTS).toContain("qa");
    const ids = manifest.migrations.map((m) => m.id);
    expect(ids[ids.length - 1]).toBe("200_qa_feature_map");
  });

  it("has a manifest checksum matching the on-disk up.sql", () => {
    const entry = manifest.migrations.find((m) => m.id === "200_qa_feature_map")!;
    const content = readFileSync(resolve(MIGRATIONS_ROOT, entry.path));
    expect(entry.checksum).toBe(createHash("sha256").update(content).digest("hex"));
  });

  it("creates the qa schema with its four tables, and re-applies cleanly", async () => {
    const db = await migrated();
    const r = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'qa' ORDER BY table_name",
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(["areas", "feature_edges", "features", "hubs"]);
    await expect(db.exec(QA_SQL)).resolves.toBeDefined();
    await db.close();
  });
});

describe("qa repository against a real Postgres engine", () => {
  it("creates, reads and lists hubs, and refuses a duplicate slug in one org", async () => {
    const db = await migrated();
    const repo = createQaRepository(executorOver(db));
    const hub = await seedHub(repo);
    expect((await repo.getHub(ORG, hub.id)).ok).toBe(true);
    expect((await repo.getHub(OTHER_ORG, hub.id)).ok).toBe(false);
    expect(await repo.createHub({ id: id(), orgId: ORG, name: "Again", slug: "ORUN-QA", stageUrl: null, prodUrl: null, createdAt: AT }))
      .toEqual({ ok: false, error: { kind: "conflict", entity: "hub" } });
    expect((await seedHub(repo, OTHER_ORG)).orgId).toBe(OTHER_ORG);
    const list = await repo.listHubs(ORG);
    expect(list.ok && list.value.map((h) => h.id)).toEqual([hub.id]);
    expect(hub.createdAt.toISOString()).toBe(AT.toISOString());
    await db.close();
  });

  it("stores features with JSONB lists and a real boolean, enforces unique names, and updates in place", async () => {
    const db = await migrated();
    const repo = createQaRepository(executorOver(db));
    const hub = await seedHub(repo);
    const area = await repo.createArea({ id: id(), orgId: ORG, hubId: hub.id, name: "Projects & tasks", position: 1, createdAt: AT });
    if (!area.ok) throw new Error("area");
    const created = await repo.createFeature({
      id: id(), orgId: ORG, hubId: hub.id, areaId: area.value.id, name: "Archive a project",
      description: "Put a finished project away.", ownerUserId: "usr_pm", qaUserId: "usr_qa", isPublic: true,
      codeRefs: ["apps/projects-worker/src/handlers/archive-project.ts"], specLinks: ["LIN-498"], createdAt: AT,
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    expect(created.value).toMatchObject({ isPublic: true, codeRefs: ["apps/projects-worker/src/handlers/archive-project.ts"], specLinks: ["LIN-498"] });

    const raw = await db.query<{ is_public: unknown; code_refs: unknown }>("SELECT is_public, code_refs FROM qa.features");
    expect(raw.rows[0]).toEqual({ is_public: true, code_refs: ["apps/projects-worker/src/handlers/archive-project.ts"] });

    expect(await repo.createFeature({
      id: id(), orgId: ORG, hubId: hub.id, areaId: null, name: "archive a PROJECT", description: "", ownerUserId: null,
      qaUserId: null, isPublic: false, codeRefs: [], specLinks: [], createdAt: AT,
    })).toEqual({ ok: false, error: { kind: "conflict", entity: "feature" } });

    const later = new Date("2026-10-04T11:00:00.000Z");
    const updated = await repo.updateFeature(ORG, hub.id, created.value.id, { description: "Tasks lock instead.", isPublic: false, specLinks: ["LIN-498", "LIN-512"], updatedAt: later });
    expect(updated.ok && updated.value).toMatchObject({ description: "Tasks lock instead.", isPublic: false, specLinks: ["LIN-498", "LIN-512"] });
    expect(updated.ok && updated.value.updatedAt.toISOString()).toBe(later.toISOString());

    await repo.updateFeature(ORG, hub.id, created.value.id, { status: "archived", updatedAt: later });
    const list = await repo.listFeatures(ORG, hub.id);
    expect(list.ok && list.value).toEqual([]);
    await db.close();
  });

  it("refuses an area from another hub", async () => {
    const db = await migrated();
    const repo = createQaRepository(executorOver(db));
    const a = await seedHub(repo);
    const b = await seedHub(repo, ORG, "other");
    const area = await repo.createArea({ id: id(), orgId: ORG, hubId: b.id, name: "Billing", position: 0, createdAt: AT });
    if (!area.ok) throw new Error("area");
    expect(await repo.createFeature({
      id: id(), orgId: ORG, hubId: a.id, areaId: area.value.id, name: "Invoices", description: "", ownerUserId: null,
      qaUserId: null, isPublic: false, codeRefs: [], specLinks: [], createdAt: AT,
    })).toEqual({ ok: false, error: { kind: "invalid", reason: "area_not_in_hub" } });
    await db.close();
  });

  it("records edges within one hub, refusing self, cross-hub and duplicate edges, and deletes once", async () => {
    const db = await migrated();
    const repo = createQaRepository(executorOver(db));
    const hub = await seedHub(repo);
    const create = await seedFeature(repo, hub.id, "Create a project");
    const archive = await seedFeature(repo, hub.id, "Archive a project");
    const other = await seedHub(repo, ORG, "other");
    const foreign = await seedFeature(repo, other.id, "Invoices");
    const edge = (from: string, to: string, source: "human" | "agent" = "human") =>
      repo.createEdge({ id: id(), orgId: ORG, hubId: hub.id, fromFeatureId: from, toFeatureId: to, source, confirmedBy: source === "human" ? "usr_pm" : null, createdAt: AT });

    const human = await edge(create.id, archive.id);
    expect(human.ok && human.value.confirmedAt?.toISOString()).toBe(AT.toISOString());
    expect(await edge(create.id, archive.id)).toEqual({ ok: false, error: { kind: "conflict", entity: "edge" } });
    expect(await edge(create.id, create.id)).toEqual({ ok: false, error: { kind: "invalid", reason: "self_edge" } });
    expect(await edge(create.id, foreign.id)).toEqual({ ok: false, error: { kind: "invalid", reason: "feature_not_in_hub" } });

    const agent = await edge(archive.id, create.id, "agent");
    if (!agent.ok) throw new Error("agent edge");
    expect(agent.value.confirmedAt).toBeNull();
    const confirmed = await repo.confirmEdge(ORG, hub.id, agent.value.id, "usr_pm", AT);
    expect(confirmed.ok && confirmed.value.confirmedBy).toBe("usr_pm");
    expect((await repo.listEdges(ORG, hub.id)).ok).toBe(true);
    expect((await repo.deleteEdge(ORG, hub.id, agent.value.id)).ok).toBe(true);
    expect(await repo.deleteEdge(ORG, hub.id, agent.value.id)).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await repo.listEdges(OTHER_ORG, hub.id)).toEqual({ ok: true, value: [] });
    await db.close();
  });
});
