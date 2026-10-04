-- 200_qa_feature_map
-- Orun QA feature map — hubs, areas, features and the dependency edges between features (QA1)
-- Bounded context: qa

CREATE SCHEMA IF NOT EXISTS qa;

COMMENT ON SCHEMA qa IS 'Orun QA bounded context — owns hubs and everything a hub describes.';

-- Hubs: one per product an organization tests. A hub may connect to one Orunbase workspace.
CREATE TABLE IF NOT EXISTS qa.hubs (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  slug_lower         TEXT NOT NULL,
  stage_url          TEXT,
  prod_url           TEXT,
  orunbase_workspace TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE qa.hubs IS 'A product under test. Every query must scope by org_id.';
COMMENT ON COLUMN qa.hubs.orunbase_workspace IS 'The connected Orunbase workspace (ws_…), opaque; null until connected.';

CREATE UNIQUE INDEX IF NOT EXISTS qa_hubs_org_slug_lower_idx ON qa.hubs (org_id, slug_lower);
CREATE UNIQUE INDEX IF NOT EXISTS qa_hubs_org_id_id_idx ON qa.hubs (org_id, id);

-- Areas: how a hub groups its features ("Projects & tasks", "Billing").
CREATE TABLE IF NOT EXISTS qa.areas (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL,
  hub_id      UUID NOT NULL,
  name        TEXT NOT NULL,
  name_lower  TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, hub_id) REFERENCES qa.hubs (org_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS qa_areas_hub_name_lower_idx ON qa.areas (org_id, hub_id, name_lower);

-- Features: what a customer can do, described for a product manager.
CREATE TABLE IF NOT EXISTS qa.features (
  id             UUID PRIMARY KEY,
  org_id         UUID NOT NULL,
  hub_id         UUID NOT NULL,
  area_id        UUID,
  name           TEXT NOT NULL,
  name_lower     TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  owner_user_id  TEXT,
  qa_user_id     TEXT,
  is_public      BOOLEAN NOT NULL DEFAULT false,
  code_refs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  spec_links     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, hub_id) REFERENCES qa.hubs (org_id, id)
);

COMMENT ON COLUMN qa.features.code_refs IS 'Paths, routes and components that implement the feature.';
COMMENT ON COLUMN qa.features.spec_links IS 'Tracker references (LIN-498, ORUN-212).';

CREATE UNIQUE INDEX IF NOT EXISTS qa_features_hub_name_lower_idx ON qa.features (org_id, hub_id, name_lower);
CREATE UNIQUE INDEX IF NOT EXISTS qa_features_org_id_id_idx ON qa.features (org_id, id);
CREATE INDEX IF NOT EXISTS qa_features_hub_area_idx ON qa.features (org_id, hub_id, area_id);

-- Edges: "to needs from". If from breaks, to is affected.
CREATE TABLE IF NOT EXISTS qa.feature_edges (
  id               UUID PRIMARY KEY,
  org_id           UUID NOT NULL,
  hub_id           UUID NOT NULL,
  from_feature_id  UUID NOT NULL,
  to_feature_id    UUID NOT NULL,
  source           TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'agent')),
  confirmed_by     TEXT,
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_feature_id <> to_feature_id),
  FOREIGN KEY (org_id, from_feature_id) REFERENCES qa.features (org_id, id),
  FOREIGN KEY (org_id, to_feature_id) REFERENCES qa.features (org_id, id)
);

COMMENT ON COLUMN qa.feature_edges.confirmed_at IS 'Null while an agent-proposed edge awaits a person.';

CREATE UNIQUE INDEX IF NOT EXISTS qa_feature_edges_pair_idx ON qa.feature_edges (org_id, hub_id, from_feature_id, to_feature_id);
