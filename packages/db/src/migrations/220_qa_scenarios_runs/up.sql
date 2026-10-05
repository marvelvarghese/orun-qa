-- 220_qa_scenarios_runs
-- Orun QA scenarios and runs (QA2): scenarios of a feature with their steps, runs
-- of a hub, one result per scenario per run, and the DOM recording of a result.
-- Bounded context: qa

-- A scenario proves one thing about a feature, in plain steps.
CREATE TABLE IF NOT EXISTS qa.scenarios (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL,
  hub_id      UUID NOT NULL,
  feature_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  name_lower  TEXT NOT NULL,
  expected    TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'screens_apis' CHECK (kind IN ('screens_apis', 'api_only')),
  cadence     TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'release', 'manual')),
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved', 'quarantined', 'archived')),
  as_role     TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, feature_id) REFERENCES qa.features (org_id, id)
);
COMMENT ON TABLE qa.scenarios IS 'A scenario that proves a feature works. Only approved scenarios run on schedule.';
CREATE UNIQUE INDEX IF NOT EXISTS qa_scenarios_feature_active_name_idx
  ON qa.scenarios (org_id, feature_id, name_lower) WHERE state <> 'archived';
CREATE UNIQUE INDEX IF NOT EXISTS qa_scenarios_org_id_id_idx ON qa.scenarios (org_id, id);
CREATE INDEX IF NOT EXISTS qa_scenarios_hub_idx ON qa.scenarios (org_id, hub_id, state);

-- A step is one plain sentence and the action that performs or checks it.
CREATE TABLE IF NOT EXISTS qa.steps (
  id           UUID PRIMARY KEY,
  org_id       UUID NOT NULL,
  scenario_id  UUID NOT NULL,
  ord          INTEGER NOT NULL CHECK (ord >= 0),
  text         TEXT NOT NULL,
  action       JSONB NOT NULL,
  FOREIGN KEY (org_id, scenario_id) REFERENCES qa.scenarios (org_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN qa.steps.action IS 'What the runner does: goto, click, fill, press, expect_text, expect_url, expect_visible, expect_response.';
CREATE UNIQUE INDEX IF NOT EXISTS qa_steps_scenario_ord_idx ON qa.steps (org_id, scenario_id, ord);

-- A run is one pass of a hub's scenarios against an environment.
CREATE TABLE IF NOT EXISTS qa.runs (
  id           UUID PRIMARY KEY,
  org_id       UUID NOT NULL,
  hub_id       UUID NOT NULL,
  trigger      TEXT NOT NULL CHECK (trigger IN ('schedule', 'deploy', 'manual', 'try')),
  env          TEXT NOT NULL DEFAULT 'stage',
  ref          TEXT,
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'errored')),
  created_by   TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  FOREIGN KEY (org_id, hub_id) REFERENCES qa.hubs (org_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS qa_runs_org_id_id_idx ON qa.runs (org_id, id);
CREATE INDEX IF NOT EXISTS qa_runs_hub_started_idx ON qa.runs (org_id, hub_id, started_at DESC);

-- A result is how one scenario went in one run.
CREATE TABLE IF NOT EXISTS qa.results (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  run_id        UUID NOT NULL,
  scenario_id   UUID NOT NULL,
  feature_id    UUID NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('works', 'fails', 'skipped', 'errored')),
  failing_step  INTEGER,
  message       TEXT NOT NULL DEFAULT '',
  duration_ms   INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  step_timings  JSONB NOT NULL DEFAULT '[]'::jsonb,
  api_calls     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, run_id) REFERENCES qa.runs (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, scenario_id) REFERENCES qa.scenarios (org_id, id)
);
COMMENT ON COLUMN qa.results.step_timings IS 'Per step: {ord, startMs, endMs, ok} — chapters and the failing marker in the player.';
COMMENT ON COLUMN qa.results.api_calls IS 'The API calls the page made: {method, path, status, ms} — the scenario''s API checks.';
CREATE UNIQUE INDEX IF NOT EXISTS qa_results_run_scenario_idx ON qa.results (org_id, run_id, scenario_id);
CREATE UNIQUE INDEX IF NOT EXISTS qa_results_org_id_id_idx ON qa.results (org_id, id);
CREATE INDEX IF NOT EXISTS qa_results_feature_created_idx ON qa.results (org_id, feature_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_results_scenario_created_idx ON qa.results (org_id, scenario_id, created_at DESC);

-- A recording is the rrweb DOM recording of a result, gzip-compressed and base64-encoded.
CREATE TABLE IF NOT EXISTS qa.recordings (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL,
  result_id   UUID NOT NULL,
  encoding    TEXT NOT NULL DEFAULT 'rrweb+gzip+base64' CHECK (encoding IN ('rrweb+gzip+base64')),
  size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
  events      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, result_id) REFERENCES qa.results (org_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE qa.recordings IS 'rrweb event streams, stored compressed in Postgres until object storage is set up.';
CREATE UNIQUE INDEX IF NOT EXISTS qa_recordings_result_idx ON qa.recordings (org_id, result_id);
