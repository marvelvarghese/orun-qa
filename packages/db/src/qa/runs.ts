import type { SqlExecutor, TransactionalSqlExecutor } from "../hyperdrive/executor.js";
import type { QaResult } from "./types.js";

/**
 * Orun QA scenarios and runs (QA2). Scenarios belong to a feature and carry
 * ordered steps; a run is one pass of a hub's scenarios; a result is one
 * scenario in one run; a recording is a result's rrweb DOM recording.
 *
 * Parameters are always scalars: the production driver runs with
 * `fetch_types: false`, which cannot bind a JS array (see the membership
 * repository's listRoleAssignmentsForSubjects). Lists become `IN ($n, …)`.
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
  approvedBy: string | null;
  approvedAt: Date | null;
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

/** What feature health is computed from: one verdict per approved scenario. */
export interface HealthVerdict {
  featureId: string;
  scenarioId: string;
  verdict: Verdict;
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
  /** An explicit move to draft, quarantined or archived. */
  state?: Exclude<ScenarioState, "approved"> | undefined;
  asRole?: string | null | undefined;
  /** Replace every step; `stepIds` must match it one to one. */
  steps?: { steps: Step[]; stepIds: string[] } | undefined;
  /** The edit changes what the scenario does: an approved scenario goes back to draft. */
  demoteIfApproved: boolean;
  /** Answer not_found if the scenario is approved — the caller may not take it out of the gate. */
  refuseIfApproved: boolean;
  updatedAt: Date;
}

export interface AddResultInput {
  id: string;
  orgId: string;
  hubId: string;
  runId: string;
  scenarioId: string;
  featureId: string;
  verdict: Verdict;
  failingStep: number | null;
  message: string;
  durationMs: number;
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  recording: { id: string; events: string; sizeBytes: number } | null;
  createdAt: Date;
}

export interface QaRunsRepository {
  createScenario(input: CreateScenarioInput): Promise<QaResult<Scenario>>;
  getScenario(orgId: string, hubId: string, id: string): Promise<QaResult<Scenario>>;
  listScenarios(orgId: string, hubId: string, filter?: { featureId?: string }): Promise<QaResult<Scenario[]>>;
  updateScenario(orgId: string, hubId: string, id: string, input: UpdateScenarioInput): Promise<QaResult<Scenario>>;
  /**
   * Approve exactly the version the PM saw: conflict when the scenario changed
   * since `seenUpdatedAt`, or is archived.
   */
  approveScenario(orgId: string, hubId: string, id: string, seenUpdatedAt: Date, approvedBy: string, at: Date): Promise<QaResult<Scenario>>;

  createRun(input: { id: string; orgId: string; hubId: string; trigger: RunTrigger; env: string; ref: string | null; createdBy: string | null; startedAt: Date }): Promise<QaResult<Run>>;
  getRun(orgId: string, hubId: string, id: string): Promise<QaResult<Run>>;
  listRuns(orgId: string, hubId: string, limit: number): Promise<QaResult<Run[]>>;
  /** Finish a running run; its status is computed from its results under the run's lock. */
  finishRun(orgId: string, hubId: string, id: string, errored: boolean, at: Date): Promise<QaResult<Run>>;

  /** Add a result (and its recording) only while the run is running in this hub; conflict otherwise. */
  addResult(input: AddResultInput): Promise<QaResult<RunResult>>;
  listResults(orgId: string, runId: string): Promise<QaResult<RunResult[]>>;
  /** The newest result of every scenario in the hub. */
  latestResults(orgId: string, hubId: string): Promise<QaResult<RunResult[]>>;
  /** A scenario's results, newest first. */
  scenarioResults(orgId: string, scenarioId: string, limit: number): Promise<QaResult<RunResult[]>>;
  /**
   * For health: the newest verdict of each approved scenario, counting only
   * results recorded since it was approved, and never from a "try" run.
   */
  healthVerdicts(orgId: string, hubId: string): Promise<QaResult<HealthVerdict[]>>;

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

/** Thrown inside a transaction to roll it back with a domain answer. */
class Abort extends Error {
  constructor(readonly result: QaResult<never>) {
    super("abort");
  }
}

const NOT_FOUND: QaResult<never> = { ok: false, error: { kind: "not_found" } };
const conflict = (entity: string): QaResult<never> => ({ ok: false, error: { kind: "conflict", entity } });
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
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
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

function mapRecording(row: Row): Recording {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    resultId: row.result_id as string,
    encoding: "rrweb+gzip+base64",
    sizeBytes: Number(row.size_bytes),
    events: row.events as string,
    createdAt: iso(row.created_at),
  };
}

const RESULT_COLUMNS = `r.id, r.org_id, r.run_id, r.scenario_id, r.feature_id, r.verdict, r.failing_step, r.message,
  r.duration_ms, r.step_timings, r.api_calls, r.created_at, rec.id AS recording_id`;

/** `$start, $start+1, …` for a list of scalar parameters. */
const placeholders = (n: number, start: number) => Array.from({ length: n }, (_, i) => `$${start + i}`).join(", ");

export function createQaRunsRepository(executor: SqlExecutor | TransactionalSqlExecutor): QaRunsRepository {
  const tx = <T>(fn: (ex: SqlExecutor) => Promise<T>): Promise<T> =>
    "transaction" in executor && typeof executor.transaction === "function" ? executor.transaction(fn) : fn(executor);

  async function stepsFor(ex: SqlExecutor, orgId: string, scenarioIds: string[]): Promise<Map<string, Step[]>> {
    const out = new Map<string, Step[]>(scenarioIds.map((id) => [id, []]));
    if (scenarioIds.length === 0) return out;
    const r = await ex.execute<Row>(
      `SELECT scenario_id, ord, text, action FROM qa.steps
        WHERE org_id = $1 AND scenario_id IN (${placeholders(scenarioIds.length, 2)})
        ORDER BY scenario_id, ord`,
      [orgId, ...scenarioIds],
    );
    for (const row of r.rows) out.get(row.scenario_id as string)?.push({ ord: Number(row.ord), text: row.text as string, action: json<Record<string, unknown>>(row.action, {}) });
    return out;
  }

  async function writeSteps(ex: SqlExecutor, orgId: string, scenarioId: string, steps: Step[], ids: string[]): Promise<void> {
    if (ids.length !== steps.length) throw new Error("step ids do not match steps");
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      await ex.execute(
        `INSERT INTO qa.steps (id, org_id, scenario_id, ord, text, action) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
        [ids[i], orgId, scenarioId, s.ord, s.text, JSON.stringify(s.action)],
      );
    }
  }

  async function withSteps(ex: SqlExecutor, row: Row): Promise<Scenario> {
    const steps = await stepsFor(ex, row.org_id as string, [row.id as string]);
    return mapScenario(row, steps.get(row.id as string) ?? []);
  }

  async function guard<T>(what: string, fn: () => Promise<QaResult<T>>): Promise<QaResult<T>> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Abort) return err.result;
      if (pgCode(err) === "23505") return conflict(what);
      if (pgCode(err) === "23503") return NOT_FOUND;
      return internal(`Failed: ${what}`);
    }
  }

  return {
    createScenario(input) {
      return guard("scenario", () =>
        tx(async (ex) => {
          const f = await ex.execute(`SELECT id FROM qa.features WHERE org_id = $1 AND hub_id = $2 AND id = $3 AND status = 'active'`, [input.orgId, input.hubId, input.featureId]);
          if (f.rowCount === 0) return { ok: false, error: { kind: "invalid", reason: "feature_not_in_hub" } } as QaResult<Scenario>;
          const r = await ex.execute<Row>(
            `INSERT INTO qa.scenarios (id, org_id, hub_id, feature_id, name, name_lower, expected, kind, cadence, state, as_role, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, $12) RETURNING *`,
            [input.id, input.orgId, input.hubId, input.featureId, input.name, input.name.toLowerCase(), input.expected, input.kind, input.cadence, input.asRole, input.createdBy, input.createdAt.toISOString()],
          );
          await writeSteps(ex, input.orgId, input.id, input.steps, input.stepIds);
          return { ok: true, value: mapScenario(r.rows[0]!, input.steps) } as QaResult<Scenario>;
        }),
      );
    },

    getScenario(orgId, hubId, id) {
      return guard("scenario", async () => {
        const r = await executor.execute<Row>(`SELECT * FROM qa.scenarios WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
        if (r.rowCount === 0) return NOT_FOUND;
        return { ok: true, value: await withSteps(executor, r.rows[0]!) };
      });
    },

    listScenarios(orgId, hubId, filter = {}) {
      return guard("scenario", async () => {
        const params: unknown[] = [orgId, hubId];
        let where = `org_id = $1 AND hub_id = $2 AND state IN ('draft', 'approved', 'quarantined')`;
        if (filter.featureId) {
          params.push(filter.featureId);
          where += ` AND feature_id = $${params.length}`;
        }
        const r = await executor.execute<Row>(`SELECT * FROM qa.scenarios WHERE ${where} ORDER BY name_lower ASC`, params);
        const steps = await stepsFor(executor, orgId, r.rows.map((x) => x.id as string));
        return { ok: true, value: r.rows.map((row) => mapScenario(row, steps.get(row.id as string) ?? [])) };
      });
    },

    updateScenario(orgId, hubId, id, input) {
      return guard("scenario", () =>
        tx(async (ex) => {
          // Lock the row: concurrent edits of one scenario apply one after the other.
          const cur = await ex.execute<Row>(`SELECT * FROM qa.scenarios WHERE org_id = $1 AND hub_id = $2 AND id = $3 FOR UPDATE`, [orgId, hubId, id]);
          if (cur.rowCount === 0) throw new Abort(NOT_FOUND);
          const state = cur.rows[0]!.state as ScenarioState;
          if (state === "archived") throw new Abort(conflict("archived scenario"));
          if (input.refuseIfApproved && state === "approved") throw new Abort(NOT_FOUND);

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
          if (input.asRole !== undefined) add("as_role", input.asRole);
          const next = input.state ?? (input.demoteIfApproved && state === "approved" ? "draft" : undefined);
          if (next !== undefined) {
            add("state", next);
            // Leaving approved clears the approval, so results before the next one never count.
            sets.push("approved_at = NULL", "approved_by = NULL");
          }
          add("updated_at", input.updatedAt.toISOString());
          params.push(orgId, hubId, id);
          const n = params.length;
          const r = await ex.execute<Row>(`UPDATE qa.scenarios SET ${sets.join(", ")} WHERE org_id = $${n - 2} AND hub_id = $${n - 1} AND id = $${n} RETURNING *`, params);
          if (input.steps !== undefined) {
            await ex.execute(`DELETE FROM qa.steps WHERE org_id = $1 AND scenario_id = $2 RETURNING id`, [orgId, id]);
            await writeSteps(ex, orgId, id, input.steps.steps, input.steps.stepIds);
          }
          return { ok: true, value: await withSteps(ex, r.rows[0]!) } as QaResult<Scenario>;
        }),
      );
    },

    approveScenario(orgId, hubId, id, seenUpdatedAt, approvedBy, at) {
      return guard("scenario", () =>
        tx(async (ex) => {
          const r = await ex.execute<Row>(
            `UPDATE qa.scenarios SET state = 'approved', approved_by = $1, approved_at = $2, updated_at = $2
              WHERE org_id = $3 AND hub_id = $4 AND id = $5 AND state IN ('draft', 'quarantined') AND updated_at = $6
              RETURNING *`,
            [approvedBy, at.toISOString(), orgId, hubId, id, seenUpdatedAt.toISOString()],
          );
          if (r.rowCount > 0) return { ok: true, value: await withSteps(ex, r.rows[0]!) } as QaResult<Scenario>;
          const cur = await ex.execute<Row>(`SELECT * FROM qa.scenarios WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
          if (cur.rowCount === 0) return NOT_FOUND;
          const row = cur.rows[0]!;
          // Approving what is already approved, unchanged, is a no-op.
          if (row.state === "approved" && iso(row.updated_at).getTime() === seenUpdatedAt.getTime()) return { ok: true, value: await withSteps(ex, row) } as QaResult<Scenario>;
          return conflict("scenario version");
        }),
      );
    },

    createRun(input) {
      return guard("run", async () => {
        const r = await executor.execute<Row>(
          `INSERT INTO qa.runs (id, org_id, hub_id, trigger, env, ref, created_by, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [input.id, input.orgId, input.hubId, input.trigger, input.env, input.ref, input.createdBy, input.startedAt.toISOString()],
        );
        return { ok: true, value: mapRun(r.rows[0]!) };
      });
    },

    getRun(orgId, hubId, id) {
      return guard("run", async () => {
        const r = await executor.execute<Row>(`SELECT * FROM qa.runs WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapRun(r.rows[0]!) };
      });
    },

    listRuns(orgId, hubId, limit) {
      return guard("run", async () => {
        const r = await executor.execute<Row>(`SELECT * FROM qa.runs WHERE org_id = $1 AND hub_id = $2 ORDER BY started_at DESC, id DESC LIMIT $3`, [orgId, hubId, limit]);
        return { ok: true, value: r.rows.map(mapRun) };
      });
    },

    finishRun(orgId, hubId, id, errored, at) {
      return guard("run", () =>
        tx(async (ex) => {
          // Lock the run first so no result lands between reading verdicts and finishing.
          const run = await ex.execute<Row>(`SELECT status FROM qa.runs WHERE org_id = $1 AND hub_id = $2 AND id = $3 FOR UPDATE`, [orgId, hubId, id]);
          if (run.rowCount === 0) return NOT_FOUND;
          if (run.rows[0]!.status !== "running") return conflict("run");
          const v = await ex.execute<Row>(`SELECT DISTINCT verdict FROM qa.results WHERE org_id = $1 AND run_id = $2`, [orgId, id]);
          const verdicts = new Set(v.rows.map((x) => x.verdict as string));
          const status = errored ? "errored" : verdicts.has("fails") ? "failed" : verdicts.has("errored") ? "errored" : "passed";
          const r = await ex.execute<Row>(
            `UPDATE qa.runs SET finished_at = $1, status = $2 WHERE org_id = $3 AND hub_id = $4 AND id = $5 AND status = 'running' RETURNING *`,
            [at.toISOString(), status, orgId, hubId, id],
          );
          return r.rowCount === 0 ? conflict("run") : { ok: true, value: mapRun(r.rows[0]!) };
        }),
      );
    },

    addResult(input) {
      return guard("result", () =>
        tx(async (ex) => {
          // Share-lock the run: a result lands only while it is running, and finishing waits for it.
          const run = await ex.execute<Row>(`SELECT status FROM qa.runs WHERE org_id = $1 AND hub_id = $2 AND id = $3 FOR SHARE`, [input.orgId, input.hubId, input.runId]);
          if (run.rowCount === 0) return NOT_FOUND;
          if (run.rows[0]!.status !== "running") return conflict("finished run");
          const r = await ex.execute<Row>(
            `INSERT INTO qa.results (id, org_id, run_id, scenario_id, feature_id, verdict, failing_step, message, duration_ms, step_timings, api_calls, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
             RETURNING *`,
            [
              input.id, input.orgId, input.runId, input.scenarioId, input.featureId, input.verdict, input.failingStep, input.message,
              input.durationMs, JSON.stringify(input.stepTimings), JSON.stringify(input.apiCalls), input.createdAt.toISOString(),
            ],
          );
          let recordingId: string | null = null;
          if (input.recording) {
            const rec = await ex.execute<Row>(
              `INSERT INTO qa.recordings (id, org_id, result_id, size_bytes, events, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [input.recording.id, input.orgId, input.id, input.recording.sizeBytes, input.recording.events, input.createdAt.toISOString()],
            );
            recordingId = rec.rows[0]!.id as string;
          }
          return { ok: true, value: mapResult({ ...r.rows[0]!, recording_id: recordingId }) } as QaResult<RunResult>;
        }),
      );
    },

    listResults(orgId, runId) {
      return guard("result", async () => {
        const r = await executor.execute<Row>(
          `SELECT ${RESULT_COLUMNS} FROM qa.results r LEFT JOIN qa.recordings rec ON rec.org_id = r.org_id AND rec.result_id = r.id
            WHERE r.org_id = $1 AND r.run_id = $2 ORDER BY r.created_at ASC, r.id ASC`,
          [orgId, runId],
        );
        return { ok: true, value: r.rows.map(mapResult) };
      });
    },

    latestResults(orgId, hubId) {
      return guard("result", async () => {
        const r = await executor.execute<Row>(
          `SELECT DISTINCT ON (r.scenario_id) ${RESULT_COLUMNS}
             FROM qa.results r
             JOIN qa.scenarios s ON s.org_id = r.org_id AND s.id = r.scenario_id
             LEFT JOIN qa.recordings rec ON rec.org_id = r.org_id AND rec.result_id = r.id
            WHERE r.org_id = $1 AND s.hub_id = $2
            ORDER BY r.scenario_id, r.created_at DESC, r.id DESC`,
          [orgId, hubId],
        );
        return { ok: true, value: r.rows.map(mapResult) };
      });
    },

    scenarioResults(orgId, scenarioId, limit) {
      return guard("result", async () => {
        const r = await executor.execute<Row>(
          `SELECT ${RESULT_COLUMNS} FROM qa.results r LEFT JOIN qa.recordings rec ON rec.org_id = r.org_id AND rec.result_id = r.id
            WHERE r.org_id = $1 AND r.scenario_id = $2 ORDER BY r.created_at DESC, r.id DESC LIMIT $3`,
          [orgId, scenarioId, limit],
        );
        return { ok: true, value: r.rows.map(mapResult) };
      });
    },

    healthVerdicts(orgId, hubId) {
      return guard("result", async () => {
        const r = await executor.execute<Row>(
          `SELECT DISTINCT ON (r.scenario_id) r.scenario_id, r.feature_id, r.verdict
             FROM qa.results r
             JOIN qa.scenarios s ON s.org_id = r.org_id AND s.id = r.scenario_id
             JOIN qa.runs run ON run.org_id = r.org_id AND run.id = r.run_id
            WHERE r.org_id = $1 AND s.hub_id = $2 AND s.state = 'approved'
              AND s.approved_at IS NOT NULL AND r.created_at >= s.approved_at
              AND run.trigger <> 'try'
            ORDER BY r.scenario_id, r.created_at DESC, r.id DESC`,
          [orgId, hubId],
        );
        return { ok: true, value: r.rows.map((x) => ({ scenarioId: x.scenario_id as string, featureId: x.feature_id as string, verdict: x.verdict as Verdict })) };
      });
    },

    getRecording(orgId, hubId, id) {
      return guard("recording", async () => {
        const r = await executor.execute<Row>(
          `SELECT rec.* FROM qa.recordings rec
             JOIN qa.results r ON r.org_id = rec.org_id AND r.id = rec.result_id
             JOIN qa.runs run ON run.org_id = r.org_id AND run.id = r.run_id
            WHERE rec.org_id = $1 AND run.hub_id = $2 AND rec.id = $3`,
          [orgId, hubId, id],
        );
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: mapRecording(r.rows[0]!) };
      });
    },
  };
}
