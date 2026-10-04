// Orun QA wire contracts (QA1 — the feature map). Envelopes follow { data, meta }.

/** Derived on read from a feature's latest scenario results; never stored. */
export type FeatureHealth = "verified" | "attention" | "broken" | "not_tested";

export interface PublicHub {
  id: string; // hub_…
  orgId: string; // org_…
  name: string;
  slug: string;
  stageUrl: string | null;
  prodUrl: string | null;
  orunbaseWorkspace: string | null;
  createdAt: string;
}

export interface PublicArea {
  id: string; // area_…
  hubId: string;
  name: string;
  position: number;
}

export interface PublicFeature {
  id: string; // feat_…
  hubId: string;
  areaId: string | null;
  name: string;
  description: string;
  ownerUserId: string | null;
  qaUserId: string | null;
  public: boolean;
  codeRefs: string[];
  specLinks: string[];
  health: FeatureHealth;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface PublicFeatureEdge {
  id: string; // edge_…
  from: string; // feat_… the feature relied on
  to: string; // feat_… the feature that needs it
  source: "human" | "agent";
  confirmed: boolean;
}

/** GET /v1/organizations/{org}/qa/hubs/{hub}/map — everything the Insights map draws. */
export interface FeatureMap {
  hub: PublicHub;
  areas: PublicArea[];
  features: PublicFeature[];
  edges: PublicFeatureEdge[];
}

/** What breaks when a feature breaks, and what it relies on. Computed from confirmed edges. */
export interface FeatureRipple {
  feature: string;
  reliesOn: string[];
  breaksDirectly: string[];
  breaksNext: string[];
}

export const QA_LIMITS = {
  nameMax: 120,
  descriptionMax: 2000,
  refsMax: 50,
  refMax: 300,
} as const;

export interface CreateHubRequest {
  name: string;
  slug?: string;
  stageUrl?: string | null;
  prodUrl?: string | null;
}

export interface CreateAreaRequest {
  name: string;
  position?: number;
}

export interface CreateFeatureRequest {
  name: string;
  description?: string;
  areaId?: string | null;
  ownerUserId?: string | null;
  qaUserId?: string | null;
  public?: boolean;
  codeRefs?: string[];
  specLinks?: string[];
}

export type UpdateFeatureRequest = Partial<CreateFeatureRequest> & { status?: "active" | "archived" };

export interface CreateEdgeRequest {
  from: string;
  to: string;
  source?: "human" | "agent";
}

/**
 * Walk confirmed edges from a feature. `breaksDirectly` are features that need it;
 * `breaksNext` are everything further downstream; `reliesOn` is everything upstream.
 */
export function computeRipple(featureId: string, edges: ReadonlyArray<Pick<PublicFeatureEdge, "from" | "to" | "confirmed">>): FeatureRipple {
  const confirmed = edges.filter((e) => e.confirmed);
  const children = (id: string) => confirmed.filter((e) => e.from === id).map((e) => e.to);
  const parents = (id: string) => confirmed.filter((e) => e.to === id).map((e) => e.from);

  const breaksDirectly = [...new Set(children(featureId))].filter((id) => id !== featureId);
  const seen = new Set<string>([featureId, ...breaksDirectly]);
  const breaksNext: string[] = [];
  const queue = [...breaksDirectly];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const c of children(id)) {
      if (!seen.has(c)) {
        seen.add(c);
        breaksNext.push(c);
        queue.push(c);
      }
    }
  }

  const reliesOn: string[] = [];
  const up = new Set<string>([featureId]);
  const upQueue = parents(featureId);
  while (upQueue.length > 0) {
    const id = upQueue.shift()!;
    if (up.has(id)) continue;
    up.add(id);
    reliesOn.push(id);
    upQueue.push(...parents(id));
  }

  return { feature: featureId, reliesOn, breaksDirectly, breaksNext };
}
