import type { SqlExecutor } from "../hyperdrive/executor.js";

// Postgres SQLSTATE classes the repository maps to domain errors.
function pgCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
    ? (err as { code: string }).code
    : null;
}
const isUniqueViolation = (err: unknown) => pgCode(err) === "23505";
const isForeignKeyViolation = (err: unknown) => pgCode(err) === "23503";
const isCheckViolation = (err: unknown) => pgCode(err) === "23514";
import type {
  Area,
  CreateAreaInput,
  CreateEdgeInput,
  CreateFeatureInput,
  CreateHubInput,
  Feature,
  FeatureEdge,
  Hub,
  QaRepository,
  QaResult,
  UpdateFeatureInput,
} from "./types.js";

type Row = Record<string, unknown>;

/** JSONB arrives parsed from the driver; tolerate a JSON string too. */
function parseList(value: unknown): string[] {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const iso = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));

function mapHub(row: Row): Hub {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    slug: row.slug as string,
    stageUrl: (row.stage_url as string | null) ?? null,
    prodUrl: (row.prod_url as string | null) ?? null,
    orunbaseWorkspace: (row.orunbase_workspace as string | null) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapArea(row: Row): Area {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    hubId: row.hub_id as string,
    name: row.name as string,
    position: Number(row.position ?? 0),
    createdAt: iso(row.created_at),
  };
}

function mapFeature(row: Row): Feature {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    hubId: row.hub_id as string,
    areaId: (row.area_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string) ?? "",
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    qaUserId: (row.qa_user_id as string | null) ?? null,
    isPublic: row.is_public === true || row.is_public === 1 || row.is_public === "t",
    codeRefs: parseList(row.code_refs),
    specLinks: parseList(row.spec_links),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapEdge(row: Row): FeatureEdge {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    hubId: row.hub_id as string,
    fromFeatureId: row.from_feature_id as string,
    toFeatureId: row.to_feature_id as string,
    source: row.source === "agent" ? "agent" : "human",
    confirmedBy: (row.confirmed_by as string | null) ?? null,
    confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null,
    createdAt: iso(row.created_at),
  };
}

function internal(message: string): QaResult<never> {
  return { ok: false, error: { kind: "internal", message } };
}

const NOT_FOUND: QaResult<never> = { ok: false, error: { kind: "not_found" } };

export function createQaRepository(executor: SqlExecutor): QaRepository {
  async function featureInHub(orgId: string, hubId: string, featureId: string): Promise<boolean> {
    const r = await executor.execute(
      `SELECT id FROM qa.features WHERE org_id = $1 AND hub_id = $2 AND id = $3 AND status = 'active'`,
      [orgId, hubId, featureId],
    );
    return r.rowCount > 0;
  }

  async function areaInHub(orgId: string, hubId: string, areaId: string): Promise<boolean> {
    const r = await executor.execute(
      `SELECT id FROM qa.areas WHERE org_id = $1 AND hub_id = $2 AND id = $3`,
      [orgId, hubId, areaId],
    );
    return r.rowCount > 0;
  }

  return {
    async createHub(input: CreateHubInput) {
      try {
        const r = await executor.execute<Row>(
          `INSERT INTO qa.hubs (id, org_id, name, slug, slug_lower, stage_url, prod_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           RETURNING *`,
          [input.id, input.orgId, input.name, input.slug, input.slug.toLowerCase(), input.stageUrl, input.prodUrl, input.createdAt.toISOString()],
        );
        return { ok: true, value: mapHub(r.rows[0]!) };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "conflict", entity: "hub" } };
        return internal("Failed to create hub");
      }
    },

    async getHub(orgId, hubId) {
      try {
        const r = await executor.execute<Row>(`SELECT * FROM qa.hubs WHERE org_id = $1 AND id = $2`, [orgId, hubId]);
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapHub(r.rows[0]!) };
      } catch {
        return internal("Failed to get hub");
      }
    },

    async listHubs(orgId) {
      try {
        const r = await executor.execute<Row>(`SELECT * FROM qa.hubs WHERE org_id = $1 ORDER BY created_at ASC, id ASC`, [orgId]);
        return { ok: true, value: r.rows.map(mapHub) };
      } catch {
        return internal("Failed to list hubs");
      }
    },

    async createArea(input: CreateAreaInput) {
      try {
        const r = await executor.execute<Row>(
          `INSERT INTO qa.areas (id, org_id, hub_id, name, name_lower, position, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [input.id, input.orgId, input.hubId, input.name, input.name.toLowerCase(), input.position, input.createdAt.toISOString()],
        );
        return { ok: true, value: mapArea(r.rows[0]!) };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "conflict", entity: "area" } };
        if (isForeignKeyViolation(err)) return NOT_FOUND;
        return internal("Failed to create area");
      }
    },

    async listAreas(orgId, hubId) {
      try {
        const r = await executor.execute<Row>(
          `SELECT * FROM qa.areas WHERE org_id = $1 AND hub_id = $2 ORDER BY position ASC, name_lower ASC`,
          [orgId, hubId],
        );
        return { ok: true, value: r.rows.map(mapArea) };
      } catch {
        return internal("Failed to list areas");
      }
    },

    async createFeature(input: CreateFeatureInput) {
      try {
        if (input.areaId && !(await areaInHub(input.orgId, input.hubId, input.areaId))) {
          return { ok: false, error: { kind: "invalid", reason: "area_not_in_hub" } };
        }
        const r = await executor.execute<Row>(
          `INSERT INTO qa.features (id, org_id, hub_id, area_id, name, name_lower, description, owner_user_id, qa_user_id,
                                    is_public, code_refs, spec_links, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $13)
           RETURNING *`,
          [
            input.id, input.orgId, input.hubId, input.areaId, input.name, input.name.toLowerCase(), input.description,
            input.ownerUserId, input.qaUserId, input.isPublic, JSON.stringify(input.codeRefs),
            JSON.stringify(input.specLinks), input.createdAt.toISOString(),
          ],
        );
        return { ok: true, value: mapFeature(r.rows[0]!) };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "conflict", entity: "feature" } };
        if (isForeignKeyViolation(err)) return NOT_FOUND;
        return internal("Failed to create feature");
      }
    },

    async getFeature(orgId, hubId, featureId) {
      try {
        const r = await executor.execute<Row>(
          `SELECT * FROM qa.features WHERE org_id = $1 AND hub_id = $2 AND id = $3`,
          [orgId, hubId, featureId],
        );
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapFeature(r.rows[0]!) };
      } catch {
        return internal("Failed to get feature");
      }
    },

    async listFeatures(orgId, hubId) {
      try {
        const r = await executor.execute<Row>(
          `SELECT * FROM qa.features WHERE org_id = $1 AND hub_id = $2 AND status = 'active' ORDER BY name_lower ASC`,
          [orgId, hubId],
        );
        return { ok: true, value: r.rows.map(mapFeature) };
      } catch {
        return internal("Failed to list features");
      }
    },

    async updateFeature(orgId, hubId, featureId, input: UpdateFeatureInput) {
      try {
        if (input.areaId && !(await areaInHub(orgId, hubId, input.areaId))) {
          return { ok: false, error: { kind: "invalid", reason: "area_not_in_hub" } };
        }
        const sets: string[] = [];
        const params: unknown[] = [];
        const add = (column: string, value: unknown, cast = "") => {
          params.push(value);
          sets.push(`${column} = $${params.length}${cast}`);
        };
        if (input.areaId !== undefined) add("area_id", input.areaId);
        if (input.name !== undefined) {
          add("name", input.name);
          add("name_lower", input.name.toLowerCase());
        }
        if (input.description !== undefined) add("description", input.description);
        if (input.ownerUserId !== undefined) add("owner_user_id", input.ownerUserId);
        if (input.qaUserId !== undefined) add("qa_user_id", input.qaUserId);
        if (input.isPublic !== undefined) add("is_public", input.isPublic);
        if (input.codeRefs !== undefined) add("code_refs", JSON.stringify(input.codeRefs), "::jsonb");
        if (input.specLinks !== undefined) add("spec_links", JSON.stringify(input.specLinks), "::jsonb");
        if (input.status !== undefined) add("status", input.status);
        add("updated_at", input.updatedAt.toISOString());
        params.push(orgId, hubId, featureId);
        const n = params.length;
        const r = await executor.execute<Row>(
          `UPDATE qa.features SET ${sets.join(", ")} WHERE org_id = $${n - 2} AND hub_id = $${n - 1} AND id = $${n} RETURNING *`,
          params,
        );
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapFeature(r.rows[0]!) };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "conflict", entity: "feature" } };
        return internal("Failed to update feature");
      }
    },

    async createEdge(input: CreateEdgeInput) {
      try {
        if (input.fromFeatureId === input.toFeatureId) {
          return { ok: false, error: { kind: "invalid", reason: "self_edge" } };
        }
        const [fromOk, toOk] = await Promise.all([
          featureInHub(input.orgId, input.hubId, input.fromFeatureId),
          featureInHub(input.orgId, input.hubId, input.toFeatureId),
        ]);
        if (!fromOk || !toOk) return { ok: false, error: { kind: "invalid", reason: "feature_not_in_hub" } };
        const at = input.createdAt.toISOString();
        const r = await executor.execute<Row>(
          `INSERT INTO qa.feature_edges (id, org_id, hub_id, from_feature_id, to_feature_id, source, confirmed_by, confirmed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            input.id, input.orgId, input.hubId, input.fromFeatureId, input.toFeatureId, input.source,
            input.confirmedBy, input.confirmedBy ? at : null, at,
          ],
        );
        return { ok: true, value: mapEdge(r.rows[0]!) };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "conflict", entity: "edge" } };
        if (isCheckViolation(err)) return { ok: false, error: { kind: "invalid", reason: "self_edge" } };
        return internal("Failed to create edge");
      }
    },

    async listEdges(orgId, hubId) {
      try {
        const r = await executor.execute<Row>(
          `SELECT * FROM qa.feature_edges WHERE org_id = $1 AND hub_id = $2 ORDER BY created_at ASC, id ASC`,
          [orgId, hubId],
        );
        return { ok: true, value: r.rows.map(mapEdge) };
      } catch {
        return internal("Failed to list edges");
      }
    },

    async confirmEdge(orgId, hubId, edgeId, confirmedBy, at) {
      try {
        const r = await executor.execute<Row>(
          `UPDATE qa.feature_edges SET confirmed_by = $1, confirmed_at = $2
           WHERE org_id = $3 AND hub_id = $4 AND id = $5 RETURNING *`,
          [confirmedBy, at.toISOString(), orgId, hubId, edgeId],
        );
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapEdge(r.rows[0]!) };
      } catch {
        return internal("Failed to confirm edge");
      }
    },

    async deleteEdge(orgId, hubId, edgeId) {
      try {
        const r = await executor.execute(
          `DELETE FROM qa.feature_edges WHERE org_id = $1 AND hub_id = $2 AND id = $3 RETURNING id`,
          [orgId, hubId, edgeId],
        );
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: { deleted: true as const } };
      } catch {
        return internal("Failed to delete edge");
      }
    },
  };
}
