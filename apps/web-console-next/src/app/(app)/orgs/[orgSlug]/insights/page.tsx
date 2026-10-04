"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Network } from "lucide-react";
import { computeRipple, type FeatureMap } from "@saas/contracts/qa";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope } from "@/components/qa/hub-scope";
import { HealthBadge } from "@/components/qa/health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { cn } from "@/lib/cn";
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

const NODE_TONE: Record<Role, string> = {
  selected: "border-foreground bg-foreground text-background",
  direct: "border-destructive bg-destructive/15",
  next: "border-warning bg-warning/15",
  relies: "border-success bg-success/15",
  none: "border-border bg-card",
};

function Inner({ orgId, orgSlug, hubId }: { orgId: string; orgSlug: string; hubId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const initial = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("feature");
  const [selected, setSelected] = React.useState<string | null>(initial);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (map.loading) return <Skeleton className="h-96 w-full" />;
  if (map.error || !map.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">{map.error?.code}</CardTitle>
          <CardDescription>{map.error?.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data: FeatureMap = map.data;
  if (data.features.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="Nothing to map yet"
        description="Add features first; then link the ones that depend on each other."
        primaryAction={{ label: "Go to Features", href: `/orgs/${orgSlug}/features` }}
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
  const names = (ids: string[]) => ids.map((id) => byId.get(id)?.name ?? "A feature");

  const edgeColor = (from: string, to: string, confirmed: boolean) => {
    if (!confirmed) return "hsl(var(--muted-foreground))";
    const a = role(from);
    const b = role(to);
    if (a === "selected" && b === "direct") return "hsl(var(--destructive))";
    if ((a === "direct" || a === "next") && b === "next") return "hsl(var(--warning))";
    if ((a === "relies" && (b === "relies" || b === "selected"))) return "hsl(var(--success))";
    return "hsl(var(--border))";
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

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Insights</p>
        <h1 className="text-2xl font-semibold tracking-tight">How the features lean on each other</h1>
        <p className="text-sm text-muted-foreground">Click a feature to see what it relies on and what breaks with it.</p>
      </header>

      <Card>
        <CardContent className="overflow-x-auto p-4">
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg width={layout.width} height={layout.height} className="absolute inset-0" aria-hidden="true">
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
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelected(n.id)}
                  aria-pressed={r === "selected"}
                  className={cn("absolute flex flex-col items-center justify-center rounded-xl border-2 px-2 text-center text-sm transition-colors", NODE_TONE[r])}
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                >
                  <span className="line-clamp-2 font-medium leading-tight">{f.name}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Arrows point from a feature to the ones that need it. Dashed links were proposed and wait for confirmation.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-foreground text-background">
          <CardHeader>
            <CardDescription className="text-background/70">Selected</CardDescription>
            <CardTitle className="text-xl">{byId.get(current)?.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <HealthBadge health={byId.get(current)!.health} />
            <Button size="sm" variant="secondary" asChild>
              <Link href={`/orgs/${orgSlug}/features/${current}`}>Open feature</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">If it breaks, these break</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {ripple.breaksDirectly.length + ripple.breaksNext.length === 0 ? (
              <span className="text-muted-foreground">Nothing else depends on it.</span>
            ) : (
              <ul className="space-y-1">
                {names(ripple.breaksDirectly).map((n) => (
                  <li key={`d-${n}`}><span className="font-medium text-destructive">Directly</span> · {n}</li>
                ))}
                {names(ripple.breaksNext).map((n) => (
                  <li key={`n-${n}`}><span className="font-medium text-warning-foreground">Next</span> · {n}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">It relies on</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {ripple.reliesOn.length === 0 ? (
              <span className="text-muted-foreground">Nothing. This is a foundation.</span>
            ) : (
              <ul className="space-y-1">
                {names(ripple.reliesOn).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link two features</CardTitle>
            <CardDescription>Say which feature needs which.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="link-to" className="text-sm font-medium">This feature</label>
                <select id="link-to" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">Choose…</option>
                  {data.features.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="link-from" className="text-sm font-medium">relies on</label>
                <select id="link-from" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">Choose…</option>
                  {data.features.filter((f) => f.id !== to).map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <Button onClick={addLink} disabled={!from || !to || busy}>Add link</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for confirmation · {pending.length}</CardTitle>
            <CardDescription>Links proposed by QA or the agent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pending.length === 0 ? (
              <span className="text-muted-foreground">Nothing waiting.</span>
            ) : (
              pending.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2">
                  <span>{byId.get(e.to)?.name} relies on {byId.get(e.from)?.name}</span>
                  <Button size="sm" variant="outline" onClick={() => confirm(e.id)}>Confirm</Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
