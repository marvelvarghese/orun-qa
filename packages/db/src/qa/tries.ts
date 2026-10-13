import type { SqlExecutor, TransactionalSqlExecutor } from "../hyperdrive/executor.js";
import type { QaResult } from "./types.js";
import type { ApiCall, Step, StepTiming } from "./runs.js";

/**
 * Orun QA tries (QA2): a plain question run once on stage by the runner's AI.
 * A try is queued by a person, claimed by the runner, and answered with the
 * steps it took, the API calls it saw and a recording. Saving it as a scenario
 * is a separate, explicit act.
 *
 * Parameters are scalars only (the production driver cannot bind arrays), and
 * every write returns its row (rowCount is the rows returned).
 */

export type TryRole = "owner" | "visitor";
export type TryStatus = "queued" | "running" | "answered" | "errored";
export type TryAnswer = "yes" | "no" | "unclear";

export interface Try {
  id: string;
  orgId: string;
  hubId: string;
  featureId: string | null;
  question: string;
  asRole: TryRole;
  status: TryStatus;
  answer: TryAnswer | null;
  headline: string;
  explanation: string;
  steps: Omit<Step, "ord">[];
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  hasRecording: boolean;
  message: string;
  savedScenarioId: string | null;
  createdBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface AnswerTryInput {
  answer: TryAnswer;
  headline: string;
  explanation: string;
  steps: Omit<Step, "ord">[];
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  recording: { events: string; sizeBytes: number } | null;
  at: Date;
}

export interface QaTriesRepository {
  createTry(input: { id: string; orgId: string; hubId: string; featureId: string | null; question: string; asRole: TryRole; createdBy: string | null; createdAt: Date }): Promise<QaResult<Try>>;
  getTry(orgId: string, hubId: string, id: string): Promise<QaResult<Try>>;
  /** A person's recent tries in a hub, newest first. */
  listTries(orgId: string, hubId: string, createdBy: string, limit: number): Promise<QaResult<Try[]>>;
  /**
   * Take the oldest queued try of the hub for the runner — first giving up any
   * try left running past `staleBefore`. Null when the queue is empty.
   */
  claimTry(orgId: string, hubId: string, claimedBy: string, at: Date, staleBefore: Date): Promise<QaResult<Try | null>>;
  /** Record the answer of a running try; conflict if it is not running. */
  answerTry(orgId: string, hubId: string, id: string, input: AnswerTryInput): Promise<QaResult<Try>>;
  /** The runner could not finish it. */
  failTry(orgId: string, hubId: string, id: string, message: string, at: Date): Promise<QaResult<Try>>;
  /** Claim a try's save for a scenario id; conflict if it is not answered or already saved. */
  markSaved(orgId: string, hubId: string, id: string, scenarioId: string): Promise<QaResult<Try>>;
  /** Release a claimed save whose scenario could not be created. */
  clearSaved(orgId: string, hubId: string, id: string, scenarioId: string): Promise<QaResult<{ cleared: boolean }>>;
  /** The try's recording (gzip + base64 rrweb events), if it has one. */
  getTryRecording(orgId: string, hubId: string, id: string): Promise<QaResult<string>>;
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
const conflict = (entity: string): QaResult<never> => ({ ok: false, error: { kind: "conflict", entity } });

/** Every column but the recording itself, which is read only on request. */
const COLUMNS = `id, org_id, hub_id, feature_id, question, as_role, status, answer, headline, explanation, steps, step_timings,
  api_calls, (recording IS NOT NULL) AS has_recording, message, saved_scenario_id, created_by, created_at, started_at, finished_at`;

function mapTry(row: Row): Try {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    hubId: row.hub_id as string,
    featureId: (row.feature_id as string | null) ?? null,
    question: row.question as string,
    asRole: row.as_role as TryRole,
    status: row.status as TryStatus,
    answer: (row.answer as TryAnswer | null) ?? null,
    headline: (row.headline as string) ?? "",
    explanation: (row.explanation as string) ?? "",
    steps: json<Omit<Step, "ord">[]>(row.steps, []),
    stepTimings: json<StepTiming[]>(row.step_timings, []),
    apiCalls: json<ApiCall[]>(row.api_calls, []),
    hasRecording: row.has_recording === true || row.has_recording === "t",
    message: (row.message as string) ?? "",
    savedScenarioId: (row.saved_scenario_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: iso(row.created_at),
    startedAt: row.started_at ? iso(row.started_at) : null,
    finishedAt: row.finished_at ? iso(row.finished_at) : null,
  };
}

export function createQaTriesRepository(executor: SqlExecutor | TransactionalSqlExecutor): QaTriesRepository {
  const tx = <T>(fn: (ex: SqlExecutor) => Promise<T>): Promise<T> =>
    "transaction" in executor && typeof executor.transaction === "function" ? executor.transaction(fn) : fn(executor);

  async function guard<T>(what: string, fn: () => Promise<QaResult<T>>): Promise<QaResult<T>> {
    try {
      return await fn();
    } catch (err) {
      if (pgCode(err) === "23505") return conflict(what);
      if (pgCode(err) === "23503") return NOT_FOUND;
      return { ok: false, error: { kind: "internal", message: `Failed: ${what}` } };
    }
  }

  async function current(ex: SqlExecutor, orgId: string, hubId: string, id: string): Promise<Try | null> {
    const r = await ex.execute<Row>(`SELECT ${COLUMNS} FROM qa.tries WHERE org_id = $1 AND hub_id = $2 AND id = $3`, [orgId, hubId, id]);
    return r.rowCount === 0 ? null : mapTry(r.rows[0]!);
  }

  return {
    createTry(input) {
      return guard("try", async () => {
        if (input.featureId) {
          const f = await executor.execute(`SELECT id FROM qa.features WHERE org_id = $1 AND hub_id = $2 AND id = $3 AND status = 'active'`, [input.orgId, input.hubId, input.featureId]);
          if (f.rowCount === 0) return { ok: false, error: { kind: "invalid", reason: "feature_not_in_hub" } };
        }
        const r = await executor.execute<Row>(
          `INSERT INTO qa.tries (id, org_id, hub_id, feature_id, question, as_role, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
          [input.id, input.orgId, input.hubId, input.featureId, input.question, input.asRole, input.createdBy, input.createdAt.toISOString()],
        );
        return { ok: true, value: mapTry(r.rows[0]!) };
      });
    },

    getTry(orgId, hubId, id) {
      return guard("try", async () => {
        const t = await current(executor, orgId, hubId, id);
        return t ? { ok: true, value: t } : NOT_FOUND;
      });
    },

    listTries(orgId, hubId, createdBy, limit) {
      return guard("try", async () => {
        const r = await executor.execute<Row>(
          `SELECT ${COLUMNS} FROM qa.tries WHERE org_id = $1 AND hub_id = $2 AND created_by = $3 ORDER BY created_at DESC, id DESC LIMIT $4`,
          [orgId, hubId, createdBy, limit],
        );
        return { ok: true, value: r.rows.map(mapTry) };
      });
    },

    claimTry(orgId, hubId, claimedBy, at, staleBefore) {
      return guard("try", () =>
        tx(async (ex) => {
          await ex.execute(
            `UPDATE qa.tries SET status = 'errored', finished_at = $1, message = 'The runner stopped before it answered. Try it again.'
              WHERE org_id = $2 AND hub_id = $3 AND status = 'running' AND started_at < $4 RETURNING id`,
            [at.toISOString(), orgId, hubId, staleBefore.toISOString()],
          );
          // SKIP LOCKED: two runners never take the same try.
          const r = await ex.execute<Row>(
            `UPDATE qa.tries SET status = 'running', started_at = $1, claimed_by = $2
              WHERE id = (SELECT id FROM qa.tries WHERE org_id = $3 AND hub_id = $4 AND status = 'queued'
                           ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
                AND org_id = $3
              RETURNING ${COLUMNS}`,
            [at.toISOString(), claimedBy, orgId, hubId],
          );
          return { ok: true, value: r.rowCount === 0 ? null : mapTry(r.rows[0]!) } as QaResult<Try | null>;
        }),
      );
    },

    answerTry(orgId, hubId, id, input) {
      return guard("try", async () => {
        const r = await executor.execute<Row>(
          `UPDATE qa.tries SET status = 'answered', answer = $1, headline = $2, explanation = $3, steps = $4::jsonb,
                  step_timings = $5::jsonb, api_calls = $6::jsonb, recording = $7, recording_bytes = $8, finished_at = $9
            WHERE org_id = $10 AND hub_id = $11 AND id = $12 AND status = 'running'
            RETURNING ${COLUMNS}`,
          [
            input.answer, input.headline, input.explanation, JSON.stringify(input.steps), JSON.stringify(input.stepTimings), JSON.stringify(input.apiCalls),
            input.recording?.events ?? null, input.recording?.sizeBytes ?? 0, input.at.toISOString(), orgId, hubId, id,
          ],
        );
        if (r.rowCount > 0) return { ok: true, value: mapTry(r.rows[0]!) };
        return (await current(executor, orgId, hubId, id)) ? conflict("try") : NOT_FOUND;
      });
    },

    failTry(orgId, hubId, id, message, at) {
      return guard("try", async () => {
        const r = await executor.execute<Row>(
          `UPDATE qa.tries SET status = 'errored', message = $1, finished_at = $2
            WHERE org_id = $3 AND hub_id = $4 AND id = $5 AND status = 'running' RETURNING ${COLUMNS}`,
          [message, at.toISOString(), orgId, hubId, id],
        );
        if (r.rowCount > 0) return { ok: true, value: mapTry(r.rows[0]!) };
        return (await current(executor, orgId, hubId, id)) ? conflict("try") : NOT_FOUND;
      });
    },

    markSaved(orgId, hubId, id, scenarioId) {
      return guard("try", async () => {
        const r = await executor.execute<Row>(
          `UPDATE qa.tries SET saved_scenario_id = $1
            WHERE org_id = $2 AND hub_id = $3 AND id = $4 AND status = 'answered' AND saved_scenario_id IS NULL RETURNING ${COLUMNS}`,
          [scenarioId, orgId, hubId, id],
        );
        if (r.rowCount > 0) return { ok: true, value: mapTry(r.rows[0]!) };
        return (await current(executor, orgId, hubId, id)) ? conflict("saved try") : NOT_FOUND;
      });
    },

    clearSaved(orgId, hubId, id, scenarioId) {
      return guard("try", async () => {
        const r = await executor.execute(
          `UPDATE qa.tries SET saved_scenario_id = NULL WHERE org_id = $1 AND hub_id = $2 AND id = $3 AND saved_scenario_id = $4 RETURNING id`,
          [orgId, hubId, id, scenarioId],
        );
        return { ok: true, value: { cleared: r.rowCount > 0 } };
      });
    },

    getTryRecording(orgId, hubId, id) {
      return guard("try", async () => {
        const r = await executor.execute<Row>(`SELECT recording FROM qa.tries WHERE org_id = $1 AND hub_id = $2 AND id = $3 AND recording IS NOT NULL`, [orgId, hubId, id]);
        return r.rowCount === 0 ? NOT_FOUND : { ok: true, value: r.rows[0]!.recording as string };
      });
    },
  };
}
