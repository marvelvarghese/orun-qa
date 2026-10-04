"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Network } from "lucide-react";
import { computeRipple, type FeatureMap } from "@saas/contracts/qa";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref } from "@/components/qa/hub-scope";
import { HEALTH_PILL } from "@/components/qa/features-view";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { layoutMap, NODE_H, NODE_W } from "@/lib/qa-map-layout";

export default function InsightsPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return (
    <OrgScope slug={slug}>
      {(org) => <HubScope orgId={org.id}>{(hub) => <Inner orgId={org.id} orgSlug={org.slug} hubId={hub.id} />}</HubScope>}
    </OrgScope>
  );
}

type Role = "selected" | "direct" | "next" | "relies" | "none";

// The canvas's node colours (Insights · feature dependency map).
const NODE_TONE: Record<Role, { bg: string; bd: string; fg: string }> = {
  selected: { bg: "#171717", bd: "#171717", fg: "#FFFFFF" },
  direct: { bg: "#F8DEDC", bd: "#C94A44", fg: "#5A1F1C" },
  next: { bg: "#F7EFDC", bd: "#C39B45", fg: "#4F3F14" },
  relies: { bg: "#E3F0E7", bd: "#3A8159", fg: "#1F4D33" },
  none: { bg: "#FFFFFF", bd: "#E1DDD4", fg: "#171717" },
};

function Inner({ orgId, orgSlug, hubId }: { orgId: string; orgSlug: string; hubId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const initial = useSearchParams()?.get("feature") ?? null;
  const [selected, setSelected] = React.useState<string | null>(initial);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (map.loading) return <Skeleton className="h-96 w-full" />;
  if (map.error || !map.data) {
    return (
      <div className="qa card" style={{ padding: 24 }}>
        <div style={{ fontWeight: 700, color: "#A33A35" }}>{map.error?.code ?? "unavailable"}</div>
        <div className="muted">{map.error?.message ?? "The feature map could not be loaded."}</div>
      </div>
    );
  }

  const data: FeatureMap = map.data;
  if (data.features.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="Nothing to map yet"
        description="Add features first; then link the ones that depend on each other."
        primaryAction={{ label: "Go to Features", href: qaHref(orgSlug, "features", hubId) }}
      />
    );
  }

  const byId = new Map(data.features.map((f) => [f.id, f]));
  const current = selected && byId.has(selected) ? selected : data.features[0]!.id;
  const ripple = computeRipple(current, data.edges);
  const role = (id: string): Role =>
    id === current
      ? "selected"
      : ripple.breaksDirectly.includes(id)
        ? "direct"
        : ripple.breaksNext.includes(id)
          ? "next"
          : ripple.reliesOn.includes(id)
            ? "relies"
            : "none";
  const layout = layoutMap(data.features, data.edges, data.areas.map((a) => a.id));
  const pending = data.edges.filter((e) => !e.confirmed);

  const edgeColor = (from: string, to: string, confirmed: boolean) => {
    if (!confirmed) return "#8A857A";
    const a = role(from);
    const b = role(to);
    if (a === "selected" && b === "direct") return "#C94A44";
    if ((a === "direct" || a === "next") && b === "next") return "#C39B45";
    if (a === "relies" && (b === "relies" || b === "selected")) return "#3A8159";
    return "#C9C4B8";
  };

  const addLink = async () => {
    if (!from || !to || from === to) return;
    setBusy(true);
    const r = await wrap(async () => (await client.qa.createEdge(orgId, hubId, { from, to })).edge);
    setBusy(false);
    if (!r.ok) {
      toast({
        kind: "error",
        title: "Link not added",
        description: r.error.code === "conflict" ? "Those two are already linked." : r.error.code === "not_found" ? "You can't change the map." : r.error.message,
      });
      return;
    }
    toast({ kind: "success", title: `${byId.get(to)?.name} now relies on ${byId.get(from)?.name}` });
    setFrom("");
    setTo("");
    map.reload();
  };

  const confirm = async (edgeId: string) => {
    const r = await wrap(async () => (await client.qa.confirmEdge(orgId, hubId, edgeId)).edge);
    if (!r.ok) {
      toast({ kind: "error", title: "Not confirmed", description: r.error.code === "not_found" ? "Only the product owner confirms links." : r.error.message });
      return;
    }
    map.reload();
  };

  const tone = NODE_TONE;
  return (
    <div className="qa">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div>
          <div className="eyebrow">Insights</div>
          <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 40, fontWeight: 500, lineHeight: 1.15 }}>
            How the features lean on each other
          </h1>
        </div>
      </div>

      <section className="card" style={{ padding: "20px 12px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "0 12px 8px" }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 500 }}>
            Feature dependency map
          </h2>
          <span className="muted" style={{ fontSize: 14 }}>
            Click any feature to see what it relies on and what breaks with it
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ position: "relative", width: layout.width, height: layout.height }}>
            <svg width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
              <defs>
                <marker id="qa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {layout.edges.map((e) => (
                <path
                  key={e.id}
                  d={e.path}
                  fill="none"
                  stroke={edgeColor(e.from, e.to, e.confirmed)}
                  strokeWidth={2}
                  strokeDasharray={e.confirmed ? undefined : "6 6"}
                  markerEnd="url(#qa-arrow)"
                />
              ))}
            </svg>
            {layout.nodes.map((n) => {
              const f = byId.get(n.id)!;
              const r = role(n.id);
              const t = tone[r];
              return (
                <button
                  key={n.id}
                  type="button"
                  className="node"
                  onClick={() => setSelected(n.id)}
                  aria-pressed={r === "selected"}
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H, background: t.bg, border: `2px solid ${t.bd}`, color: t.fg }}
                >
                  <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    <b>{f.name}</b>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: "#4A4843", margin: "12px 12px 0" }}>
          {(
            [
              ["#171717", "#171717", "Selected"],
              ["#F8DEDC", "#C94A44", "Breaks directly"],
              ["#F7EFDC", "#C39B45", "Breaks next"],
              ["#E3F0E7", "#3A8159", "It relies on"],
            ] as const
          ).map(([bg, bd, label]) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 4, background: bg, border: `2px solid ${bd}` }} />
              {label}
            </span>
          ))}
          <span>Arrow: the feature on the right needs the one on the left · dashed waits for confirmation</span>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: 20, background: "#171717", color: "#FFFFFF", borderColor: "#171717" }}>
          <div className="eyebrow" style={{ color: "#C9C4B8" }}>
            Selected
          </div>
          <div className="serif" style={{ fontSize: 26, margin: "6px 0 4px" }}>
            {byId.get(current)?.name}
          </div>
          <div style={{ color: "#D6D2C8", fontSize: 14 }}>{HEALTH_PILL[byId.get(current)!.health].label}</div>
          <Link className="btn gold" href={qaHref(orgSlug, `features/${current}`, hubId)} style={{ marginTop: 14 }}>
            Open feature
          </Link>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            It relies on
          </div>
          {ripple.reliesOn.length === 0 ? (
            <div className="muted" style={{ fontSize: 14 }}>
              Nothing. This is a foundation.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ripple.reliesOn.map((id) => (
                <span key={id} className="pill ok">
                  <i />
                  {byId.get(id)?.name ?? "A feature"}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            If it breaks, these break
          </div>
          {ripple.breaksDirectly.length + ripple.breaksNext.length === 0 ? (
            <div className="muted" style={{ fontSize: 14 }}>
              Nothing else depends on it.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ripple.breaksDirectly.map((id) => (
                <span key={`d-${id}`} className="pill bad">
                  <i />
                  {byId.get(id)?.name ?? "A feature"}
                </span>
              ))}
              {ripple.breaksNext.map((id) => (
                <span key={`n-${id}`} className="pill warn">
                  <i />
                  {byId.get(id)?.name ?? "A feature"}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16 }}>
        <section className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Link two features</div>
          <div className="muted" style={{ fontSize: 14, marginTop: -6 }}>
            Say which feature needs which.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="link-to" style={{ fontWeight: 600, fontSize: 14 }}>
                This feature
              </label>
              <select
                id="link-to"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  if (e.target.value === from) setFrom("");
                }}
              >
                <option value="">Choose…</option>
                {data.features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="link-from" style={{ fontWeight: 600, fontSize: 14 }}>
                relies on
              </label>
              <select id="link-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Choose…</option>
                {data.features
                  .filter((f) => f.id !== to)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <button type="button" className="btn primary" onClick={addLink} disabled={!from || !to || busy}>
              Add link
            </button>
          </div>
        </section>
        <section className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Waiting for confirmation · {pending.length}</div>
          <div className="muted" style={{ fontSize: 14, marginTop: -4 }}>
            Links proposed by QA or the agent.
          </div>
          {pending.length === 0 ? (
            <span className="muted" style={{ fontSize: 14 }}>
              Nothing waiting.
            </span>
          ) : (
            pending.map((e) => (
              <div key={e.id} className="api" style={{ justifyContent: "space-between" }}>
                <span>
                  {byId.get(e.to)?.name} relies on {byId.get(e.from)?.name}
                </span>
                <button type="button" className="chip" onClick={() => confirm(e.id)}>
                  Confirm
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
