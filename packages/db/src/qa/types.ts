export type { SqlExecutor } from "../hyperdrive/executor.js";

export type QaRepositoryError =
  | { kind: "not_found" }
  | { kind: "conflict"; entity: string }
  | { kind: "invalid"; reason: string }
  | { kind: "internal"; message: string };

export type QaResult<T> = { ok: true; value: T } | { ok: false; error: QaRepositoryError };

export interface Hub {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  stageUrl: string | null;
  prodUrl: string | null;
  orunbaseWorkspace: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Area {
  id: string;
  orgId: string;
  hubId: string;
  name: string;
  position: number;
  createdAt: Date;
}

export interface Feature {
  id: string;
  orgId: string;
  hubId: string;
  areaId: string | null;
  name: string;
  description: string;
  ownerUserId: string | null;
  qaUserId: string | null;
  isPublic: boolean;
  codeRefs: string[];
  specLinks: string[];
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export type EdgeSource = "human" | "agent";

export interface FeatureEdge {
  id: string;
  orgId: string;
  hubId: string;
  fromFeatureId: string;
  toFeatureId: string;
  source: EdgeSource;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface CreateHubInput {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  stageUrl: string | null;
  prodUrl: string | null;
  createdAt: Date;
}

export interface CreateAreaInput {
  id: string;
  orgId: string;
  hubId: string;
  name: string;
  position: number;
  createdAt: Date;
}

export interface CreateFeatureInput {
  id: string;
  orgId: string;
  hubId: string;
  areaId: string | null;
  name: string;
  description: string;
  ownerUserId: string | null;
  qaUserId: string | null;
  isPublic: boolean;
  codeRefs: string[];
  specLinks: string[];
  createdAt: Date;
}

export interface UpdateFeatureInput {
  areaId?: string | null | undefined;
  name?: string | undefined;
  description?: string | undefined;
  ownerUserId?: string | null | undefined;
  qaUserId?: string | null | undefined;
  isPublic?: boolean | undefined;
  codeRefs?: string[] | undefined;
  specLinks?: string[] | undefined;
  status?: "active" | "archived" | undefined;
  updatedAt: Date;
}

export interface CreateEdgeInput {
  id: string;
  orgId: string;
  hubId: string;
  fromFeatureId: string;
  toFeatureId: string;
  source: EdgeSource;
  /** A person adding an edge confirms it in the same act; an agent's edge waits. */
  confirmedBy: string | null;
  createdAt: Date;
}

export interface QaRepository {
  createHub(input: CreateHubInput): Promise<QaResult<Hub>>;
  getHub(orgId: string, hubId: string): Promise<QaResult<Hub>>;
  listHubs(orgId: string): Promise<QaResult<Hub[]>>;

  createArea(input: CreateAreaInput): Promise<QaResult<Area>>;
  listAreas(orgId: string, hubId: string): Promise<QaResult<Area[]>>;

  createFeature(input: CreateFeatureInput): Promise<QaResult<Feature>>;
  getFeature(orgId: string, hubId: string, featureId: string): Promise<QaResult<Feature>>;
  listFeatures(orgId: string, hubId: string): Promise<QaResult<Feature[]>>;
  updateFeature(orgId: string, hubId: string, featureId: string, input: UpdateFeatureInput): Promise<QaResult<Feature>>;

  createEdge(input: CreateEdgeInput): Promise<QaResult<FeatureEdge>>;
  listEdges(orgId: string, hubId: string): Promise<QaResult<FeatureEdge[]>>;
  confirmEdge(orgId: string, hubId: string, edgeId: string, confirmedBy: string, at: Date): Promise<QaResult<FeatureEdge>>;
  deleteEdge(orgId: string, hubId: string, edgeId: string): Promise<QaResult<{ deleted: true }>>;
}
