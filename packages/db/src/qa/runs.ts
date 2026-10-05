import type { SqlExecutor } from "../hyperdrive/executor.js";
import type { QaResult } from "./types.js";

/**
 * Orun QA scenarios and runs (QA2). Scenarios belong to a feature and carry
 * ordered steps; a run is one pass of a hub's scenarios; a result is one
 * scenario in one run; a recording is a result's rrweb DOM recording.
 */

export type ScenarioKind = "screens_apis" | "api_only";
export type ScenarioCadence = "daily" | "release" | "manual";
export type ScenarioState = "draft" | "approved" | "quarantined" | "archived";
export type RunTrigger = "schedule" | "deploy" | "manual" | "try";
export type RunStatus = "running" | "passed" | "failed" | "errored";
export type Verdict = "works" | "fails" | "skipped" | "errored";

export interface Step {
  ord: number;
  text: string;
  action: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  orgId: string;
  hubId: string;
  featureId: string;
  name: string;
  expected: string;
  kind: ScenarioKind;
  cadence: ScenarioCadence;
  state: ScenarioState;
  asRole: string | null;
  createdBy: string | null;
  steps: Step[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Run {
  id: string;
  orgId: string;
  hubId: string;
  trigger: RunTrigger;
  env: string;
  ref: string | null;
  status: RunStatus;
  createdBy: string | null;
  startedAt: Date;
  finishedAt: Date | null;
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

export interface RunResult {
  id: string;
  orgId: string;
  runId: string;
  scenarioId: string;
  featureId: string;
  verdict: Verdict;
  failingStep: number | null;
  message: string;
  durationMs: number;
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  recordingId: string | null;
  createdAt: Date;
}

export interface Recording {
  id: string;
  orgId: string;
  resultId: string;
  encoding: "rrweb+gzip+base64";
  sizeBytes: number;
  events: string;
  createdAt: Date;
}

export interface CreateScenarioInput {
  id: string;
  orgId: string;
  hubId: string;
  featureId: string;
  name: string;
  expected: string;
  kind: ScenarioKind;
  cadence: ScenarioCadence;
  state: ScenarioState;
  asRole: string | null;
  createdBy: string | null;
  steps: Step[];
  stepIds: string[];
  createdAt: Date;
}

export interface UpdateScenarioInput {
  name?: string | undefined;
  expected?: string | undefined;
  cadence?: ScenarioCadence | undefined;
  state?: ScenarioState | undefined;
  asRole?: string | null | undefined;
  steps?: Step[] | undefined;
  stepIds?: string[] | undefined;
  updatedAt: Date;
}

export interface AddResultInput {
  id: string;
  orgId: string;
  runId: string;
  scenarioId: string;
  featureId: string;
  verdict: Verdict;
  failingStep: number | null;
  message: string;
  durationMs: number;
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  createdAt: Date;
}

export interface QaRunsRepository {
  createScenario(input: CreateScenarioInput): Promise<QaResult<Scenario>>;
  getScenario(orgId: string, hubId: string, id: string): Promise<QaResult<Scenario>>;
  listScenarios(orgId: string, hubId: string, filter?: { featureId?: string; states?: ScenarioState[] }): Promise<QaResult<Scenario[]>>;
  updateScenario(orgId: string, hubId: string, id: string, input: UpdateScenarioInput): Promise<QaResult<Scenario>>;

  createRun(input: { id: string; orgId: string; hubId: string; trigger: RunTrigger; env: string; ref: string | null; createdBy: string | null; startedAt: Date }): Promise<QaResult<Run>>;
  getRun(orgId: string, hubId: string, id: string): Promise<QaResult<Run>>;
  listRuns(orgId: string, hubId: string, limit: number): Promise<QaResult<Run[]>>;
  finishRun(orgId: string, hubId: string, id: string, status: Exclude<RunStatus, "running">, at: Date): Promise<QaResult<Run>>;

  addResult(input: AddResultInput): Promise<QaResult<RunResult>>;
  listResults(orgId: string, runId: string): Promise<QaResult<RunResult[]>>;
  /** The newest result of every scenario in the hub — what feature health reads. */
  latestResults(orgId: string, hubId: string): Promise<QaResult<RunResult[]>>;
  /** A feature's recent results, newest first. */
  featureResults(orgId: string, featureId: string, limit: number): Promise<QaResult<RunResult[]>>;

  addRecording(input: { id: string; orgId: string; resultId: string; events: string; sizeBytes: number; createdAt: Date }): Promise<QaResult<Recording>>;
  /** A recording, only when its result's run belongs to the hub. */
  getRecording(orgId: string, hubId: string, id: string): Promise<QaResult<Recording>>;
}

type Row = Record<string, unknown>;

const iso = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

function pgCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string" ? (err as { code: string }).code : null;
}

const NOT_FOUND: QaResult<never> = { ok: false, error: { kind: "not_found" } };
const internal = (message: string): QaResult<never> => ({ ok: false, error: { kind: "internal", message } });

function mapScenario(row: Row, steps: Step[]): Scenario {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    hubId: row.hub_id as string,
    featureId: row.feature_id as string,
    name: row.name as string,
    expected: (row.expected as string) ?? "",
    kind: row.kind as ScenarioKind,
    cadence: row.cadence as ScenarioCadence,
    state: row.state as ScenarioState,
    asRole: (row.as_role as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    steps,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapRun(row: Row): Run {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    hubId: row.hub_id as string,
    trigger: row.trigger as RunTrigger,
    env: row.env as string,
    ref: (row.ref as string | null) ?? null,
    status: row.status as RunStatus,
    createdBy: (row.created_by as string | null) ?? null,
    startedAt: iso(row.started_at),
    finishedAt: row.finished_at ? iso(row.finished_at) : null,
  };
}

function mapResult(row: Row): RunResult {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    runId: row.run_id as string,
    scenarioId: row.scenario_id as string,
    featureId: row.feature_id as string,
    verdict: row.verdict as Verdict,
    failingStep: row.failing_step === null || row.failing_step === undefined ? null : Number(row.failing_step),
    message: (row.message as string) ?? "",
    durationMs: Number(row.duration_ms ?? 0),
    stepTimings: json<StepTiming[]>(row.step_timings, []),
    apiCalls: json<ApiCall[]>(row.api_calls, []),
    recordingId: (row.recording_id as string | null) ?? null,
    createdAt: iso(row.created_at),
  };
}

const RESULT_COLUMNS = `r.id, r.org_id, r.run_id, r.scenario_id, r.feature_id, r.verdict, r.failing_step, r.message,
  r.duration_ms, r.step_timings, r.api_calls, r.created_at, rec.id AS recording_id`;

export function createQaRunsRepository(executor: SqlExecutor): QaRunsRepository {
  async function stepsFor(orgId: string, scenarioIds: string[]): Promise<Map<string, Step[]>> {
    const out = new Map<string, Step[]>(scenarioIds.map((id) => [id, []]));
    if (scenarioIds.length === 0) return out;
    const r = await executor.execute<Row>(
      `SELECT scenario_id, ord, text, action FROM qa.steps WHERE org_id = $1 AND scenario_id = ANY($2::uuid[]) ORDER BY scenario_id, ord`,
      [orgId, scenarioIds],
    );
    for (const row of r.rows) out.get(row.scenario_id as string)?.push({ ord: Number(row.ord), text: row.text as string, action: json<Record<string, unknown>>(row.action, {}) });
    return out;
  }

  async function writeSteps(orgId: string, scenarioId: string, steps: Step[], ids: string[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      await executor.execute(
        `INSERT INTO qa.steps (id, org_id, scenario_id, ord, text, action) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [ids[i], orgId, scenarioId, s.ord, s.text, JSON.stringify(s.action)],
      );
    }
  }

  async function scenarioRow(orgId: string, hubId: string, id: string): Promise<Row | null> {
    const r = await executor.execute<Row>(`SELECT * FROM qa.scenarios WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
    return r.rows[0] ?? null;
  }

  return {
    async createScenario(input) {
      try {
        const f = await executor.execute(
          `SELECT id FROM qa.features WHERE org_id = $1 AND hub_id = $2 AND id = $3 AND status = 'active'`,
          [input.orgId, input.hubId, input.featureId],
        );
        if (f.rowCount === 0) return { ok: false, error: { kind: "invalid", reason: "feature_not_in_hub" } };
        const r = await executor.execute<Row>(
          `INSERT INTO qa.scenarios (id, org_id, hub_id, feature_id, name, name_lower, expected, kind, cadence, state, as_role, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
          [input.id, input.orgId, input.hubId, input.featureId, input.name, input.name.toLowerCase(), input.expected, input.kind, input.cadence, input.state, input.asRole, input.createdBy, input.createdAt.toISOString()],
        );
        try {
          await writeSteps(input.orgId, input.id, input.steps, input.stepIds);
        } catch (err) {
          // No transactions on this executor: take the half-written scenario back out.
          await executor.execute(`DELETE FROM qa.scenarios WHERE org_id = $1 AND id = $2 RETURNING id`, [input.orgId, input.id]);
          throw err;
        }
        return { ok: true, value: mapScenario(r.rows[0]!, input.steps) };
      } catch (err) {
        if (pgCode(err) === "23505") return { ok: false, error: { kind: "conflict", entity: "scenario" } };
        return internal("Failed to create scenario");
      }
    },

    async getScenario(orgId, hubId, id) {
      try {
        const row = await scenarioRow(orgId, hubId, id);
        if (!row) return NOT_FOUND;
        const steps = await stepsFor(orgId, [id]);
        return { ok: true, value: mapScenario(row, steps.get(id) ?? []) };
      } catch {
        return internal("Failed to get scenario");
      }
    },

    async listScenarios(orgId, hubId, filter = {}) {
      try {
        const params: unknown[] = [orgId, hubId];
        let where = `org_id = $1 AND hub_id = $2`;
        if (filter.featureId) {
          params.push(filter.featureId);
          where += ` AND feature_id = $${params.length}`;
        }
        const states = filter.states ?? ["draft", "approved", "quarantined"];
        params.push(states);
        where += ` AND state = ANY($${params.length}::text[])`;
        const r = await executor.execute<Row>(`SELECT * FROM qa.scenarios WHERE ${where} ORDER BY name_lower ASC`, params);
        const steps = await stepsFor(orgId, r.rows.map((x) => x.id as string));
        return { ok: true, value: r.rows.map((row) => mapScenario(row, steps.get(row.id as string) ?? [])) };
      } catch {
        return internal("Failed to list scenarios");
      }
    },

    async updateScenario(orgId, hubId, id, input) {
      try {
        const current = await scenarioRow(orgId, hubId, id);
        if (!current) return NOT_FOUND;
        const sets: string[] = [];
        const params: unknown[] = [];
        const add = (col: string, v: unknown) => {
          params.push(v);
          sets.push(`${col} = $${params.length}`);
        };
        if (input.name !== undefined) {
          add("name", input.name);
          add("name_lower", input.name.toLowerCase());
        }
        if (input.expected !== undefined) add("expected", input.expected);
        if (input.cadence !== undefined) add("cadence", input.cadence);
        if (input.state !== undefined) add("state", input.state);
        if (input.asRole !== undefined) add("as_role", input.asRole);
        add("updated_at", input.updatedAt.toISOString());
        params.push(orgId, hubId, id);
        const n = params.length;
        const r = await executor.execute<Row>(
          `UPDATE qa.scenarios SET ${sets.join(", ")} WHERE org_id = $${n - 2} AND hub_id = $${n - 1} AND id = $${n} RETURNING *`,
          params,
        );
        if (r.rowCount === 0) return NOT_FOUND;
        if (input.steps !== undefined) {
          await executor.execute(`DELETE FROM qa.steps WHERE org_id = $1 AND scenario_id = $2 RETURNING id`, [orgId, id]);
          await writeSteps(orgId, id, input.steps, input.stepIds ?? []);
        }
        const steps = await stepsFor(orgId, [id]);
        return { ok: true, value: mapScenario(r.rows[0]!, steps.get(id) ?? []) };
      } catch (err) {
        if (pgCode(err) === "23505") return { ok: false, error: { kind: "conflict", entity: "scenario" } };
        return internal("Failed to update scenario");
      }
    },

    async createRun(input) {
      try {
        const r = await executor.execute<Row>(
          `INSERT INTO qa.runs (id, org_id, hub_id, trigger, env, ref, created_by, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [input.id, input.orgId, input.hubId, input.trigger, input.env, input.ref, input.createdBy, input.startedAt.toISOString()],
        );
        return { ok: true, value: mapRun(r.rows[0]!) };
      } catch (err) {
        if (pgCode(err) === "23503") return NOT_FOUND;
        return internal("Failed to create run");
      }
    },

    async getRun(orgId, hubId, id) {
      try {
        const r = await executor.execute<Row>(`SELECT * FROM qa.runs WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapRun(r.rows[0]!) };
      } catch {
        return internal("Failed to get run");
      }
    },

    async listRuns(orgId, hubId, limit) {
      try {
        const r = await executor.execute<Row>(
          `SELECT * FROM qa.runs WHERE org_id = $1 AND hub_id = $2 ORDER BY started_at DESC, id DESC LIMIT $3`,
          [orgId, hubId, limit],
        );
        return { ok: true, value: r.rows.map(mapRun) };
      } catch {
        return internal("Failed to list runs");
      }
    },

    async finishRun(orgId, hubId, id, status, at) {
      try {
        const r = await executor.execute<Row>(
          `UPDATE qa.runs SET status = $1, finished_at = $2 WHERE org_id = $3 AND hub_id = $4 AND id = $5 AND status = 'running' RETURNING *`,
          [status, at.toISOString(), orgId, hubId, id],
        );
        if (r.rowCount > 0) return { ok: true, value: mapRun(r.rows[0]!) };
        const existing = await executor.execute<Row>(`SELECT * FROM qa.runs WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
        if (existing.rowCount === 0) return NOT_FOUND;
        return { ok: false, error: { kind: "conflict", entity: "run" } };
      } catch {
        return internal("Failed to finish run");
      }
    },

    async addResult(input) {
      try {
        const r = await executor.execute<Row>(
          `INSERT INTO qa.results (id, org_id, run_id, scenario_id, feature_id, verdict, failing_step, message, duration_ms, step_timings, api_calls, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
           RETURNING *, NULL::uuid AS recording_id`,
          [
            input.id, input.orgId, input.runId, input.scenarioId, input.featureId, input.verdict, input.failingStep, input.message,
            input.durationMs, JSON.stringify(input.stepTimings), JSON.stringify(input.apiCalls), input.createdAt.toISOString(),
          ],
        );
        return { ok: true, value: mapResult(r.rows[0]!) };
      } catch (err) {
        if (pgCode(err) === "23505") return { ok: false, error: { kind: "conflict", entity: "result" } };
        if (pgCode(err) === "23503") return NOT_FOUND;
        return internal("Failed to add result");
      }
    },

    async listResults(orgId, runId) {
      try {
        const r = await executor.execute<Row>(
          `SELECT ${RESULT_COLUMNS} FROM qa.results r LEFT JOIN qa.recordings rec ON rec.org_id = r.org_id AND rec.result_id = r.id
           WHERE r.org_id = $1 AND r.run_id = $2 ORDER BY r.created_at ASC`,
          [orgId, runId],
        );
        return { ok: true, value: r.rows.map(mapResult) };
      } catch {
        return internal("Failed to list results");
      }
    },

    async latestResults(orgId, hubId) {
      try {
        const r = await executor.execute<Row>(
          `SELECT DISTINCT ON (r.scenario_id) ${RESULT_COLUMNS}
             FROM qa.results r
             JOIN qa.runs run ON run.org_id = r.org_id AND run.id = r.run_id
             LEFT JOIN qa.recordings rec ON rec.org_id = r.org_id AND rec.result_id = r.id
            WHERE r.org_id = $1 AND run.hub_id = $2
            ORDER BY r.scenario_id, r.created_at DESC`,
          [orgId, hubId],
        );
        return { ok: true, value: r.rows.map(mapResult) };
      } catch {
        return internal("Failed to read latest results");
      }
    },

    async featureResults(orgId, featureId, limit) {
      try {
        const r = await executor.execute<Row>(
          `SELECT ${RESULT_COLUMNS} FROM qa.results r LEFT JOIN qa.recordings rec ON rec.org_id = r.org_id AND rec.result_id = r.id
           WHERE r.org_id = $1 AND r.feature_id = $2 ORDER BY r.created_at DESC LIMIT $3`,
          [orgId, featureId, limit],
        );
        return { ok: true, value: r.rows.map(mapResult) };
      } catch {
        return internal("Failed to read feature results");
      }
    },

    async addRecording(input) {
      try {
        const r = await executor.execute<Row>(
          `INSERT INTO qa.recordings (id, org_id, result_id, size_bytes, events, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [input.id, input.orgId, input.resultId, input.sizeBytes, input.events, input.createdAt.toISOString()],
        );
        const row = r.rows[0]!;
        return { ok: true, value: { id: row.id as string, orgId: row.org_id as string, resultId: row.result_id as string, encoding: "rrweb+gzip+base64", sizeBytes: Number(row.size_bytes), events: row.events as string, createdAt: iso(row.created_at) } };
      } catch (err) {
        if (pgCode(err) === "23505") return { ok: false, error: { kind: "conflict", entity: "recording" } };
        if (pgCode(err) === "23503") return NOT_FOUND;
        return internal("Failed to store recording");
      }
    },

    async getRecording(orgId, hubId, id) {
      try {
        const r = await executor.execute<Row>(
          `SELECT rec.* FROM qa.recordings rec
             JOIN qa.results r ON r.org_id = rec.org_id AND r.id = rec.result_id
             JOIN qa.runs run ON run.org_id = r.org_id AND run.id = r.run_id
            WHERE rec.org_id = $1 AND run.hub_id = $2 AND rec.id = $3`,
          [orgId, hubId, id],
        );
        if (r.rowCount === 0) return NOT_FOUND;
        const row = r.rows[0]!;
        return { ok: true, value: { id: row.id as string, orgId: row.org_id as string, resultId: row.result_id as string, encoding: "rrweb+gzip+base64", sizeBytes: Number(row.size_bytes), events: row.events as string, createdAt: iso(row.created_at) } };
      } catch {
        return internal("Failed to read recording");
      }
    },
  };
}
