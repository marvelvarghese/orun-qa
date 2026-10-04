-- 210_qa_feature_name_active
-- A feature's name is unique among a hub's ACTIVE features only, so an archived
-- feature's name can be used again (QA1 review).
-- Bounded context: qa

DROP INDEX IF EXISTS qa.qa_features_hub_name_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS qa_features_hub_active_name_lower_idx
  ON qa.features (org_id, hub_id, name_lower)
  WHERE status = 'active';
