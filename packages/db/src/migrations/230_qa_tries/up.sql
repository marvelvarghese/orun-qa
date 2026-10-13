-- 230_qa_tries
-- Orun QA tries (QA2): a plain question someone asks, run once on stage by the
-- runner's AI in a real browser, answered with a recording. Nothing becomes a
-- scenario unless the person saves it.
-- Bounded context: qa

CREATE TABLE IF NOT EXISTS qa.tries (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL,
  hub_id            UUID NOT NULL,
  feature_id        UUID,
  question          TEXT NOT NULL,
  as_role           TEXT NOT NULL DEFAULT 'owner' CHECK (as_role IN ('owner', 'visitor')),
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'answered', 'errored')),
  answer            TEXT CHECK (answer IN ('yes', 'no', 'unclear')),
  headline          TEXT NOT NULL DEFAULT '',
  explanation       TEXT NOT NULL DEFAULT '',
  steps             JSONB NOT NULL DEFAULT '[]'::jsonb,
  step_timings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  api_calls         JSONB NOT NULL DEFAULT '[]'::jsonb,
  recording         TEXT,
  recording_bytes   INTEGER NOT NULL DEFAULT 0 CHECK (recording_bytes >= 0),
  message           TEXT NOT NULL DEFAULT '',
  saved_scenario_id UUID,
  created_by        TEXT,
  claimed_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  FOREIGN KEY (org_id, hub_id) REFERENCES qa.hubs (org_id, id),
  FOREIGN KEY (org_id, feature_id) REFERENCES qa.features (org_id, id)
);
COMMENT ON TABLE qa.tries IS 'A question tried once on stage by the runner''s AI; saved as a scenario only on request.';
COMMENT ON COLUMN qa.tries.steps IS 'What the AI did, as scenario steps ({text, action}) — saving the try saves these.';
COMMENT ON COLUMN qa.tries.recording IS 'rrweb events, gzip-compressed and base64-encoded, as for qa.recordings.';
CREATE UNIQUE INDEX IF NOT EXISTS qa_tries_org_id_id_idx ON qa.tries (org_id, id);
CREATE INDEX IF NOT EXISTS qa_tries_hub_created_idx ON qa.tries (org_id, hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_tries_queue_idx ON qa.tries (status, created_at) WHERE status IN ('queued', 'running');
