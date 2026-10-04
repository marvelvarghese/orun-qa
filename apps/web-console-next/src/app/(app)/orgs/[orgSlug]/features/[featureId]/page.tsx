"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Film } from "lucide-react";
import type { FeatureMap, PublicFeature } from "@saas/contracts/qa";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref } from "@/components/qa/hub-scope";
import { HealthBadge } from "@/components/qa/health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";

export default function FeaturePage() {
  const params = useParams<{ orgSlug: string; featureId: string }>();
  const slug = params?.orgSlug ?? "";
  const featureId = params?.featureId ?? "";
  return (
    <OrgScope slug={slug}>
      {(org) => (
        <HubScope orgId={org.id}>
          {(hub) => <Inner orgId={org.id} orgSlug={org.slug} hubId={hub.id} featureId={featureId} />}
        </HubScope>
      )}
    </OrgScope>
  );
}

function FeatureLinks({ ids, map, orgSlug, hubId, empty, tone }: { ids: string[]; map: FeatureMap | null; orgSlug: string; hubId: string; empty: string; tone: string }) {
  if (ids.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const byId = new Map((map?.features ?? []).map((f) => [f.id, f]));
  return (
    <ul className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <li key={id}>
          <Link href={qaHref(orgSlug, `features/${id}`, hubId)} className={`inline-flex h-9 items-center rounded-full border px-3 text-sm ${tone}`}>
            {byId.get(id)?.name ?? "A feature"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Inner({ orgId, orgSlug, hubId, featureId }: { orgId: string; orgSlug: string; hubId: string; featureId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const detail = useApiQuery(qk.qaFeature(orgId, hubId, featureId), () => wrap(() => client.qa.getFeature(orgId, hubId, featureId)));
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const [description, setDescription] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (detail.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="aspect-[16/9] w-full max-w-3xl" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">{detail.error?.code ?? "not_found"}</CardTitle>
          <CardDescription>{detail.error?.message ?? "This feature does not exist."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { feature, ripple } = detail.data;
  const areas = map.data?.areas ?? [];
  const text = description ?? feature.description;

  const save = async (patch: Partial<Pick<PublicFeature, "description" | "areaId" | "public">>, label: string) => {
    setSaving(true);
    const r = await wrap(async () => (await client.qa.updateFeature(orgId, hubId, feature.id, patch)).feature);
    setSaving(false);
    if (!r.ok) {
      toast({
        kind: "error",
        title: "Not saved",
        description: r.error.code === "not_found" ? "Only the product owner can change a feature." : r.error.message,
      });
      return;
    }
    toast({ kind: "success", title: label });
    setDescription(null);
    detail.reload();
    void qc.invalidateQueries({ queryKey: qk.qaMap(orgId, hubId) });
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={qaHref(orgSlug, "features", hubId)} className="hover:text-foreground">
          Features
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-foreground">{feature.name}</span>
      </nav>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{feature.name}</h1>
        <HealthBadge health={feature.health} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted text-center text-sm text-muted-foreground">
            <Film className="h-6 w-6" aria-hidden="true" />
            The recording of this feature working appears here after its first verified run.
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">When this breaks, these are affected</CardTitle>
              <CardDescription>From the confirmed links on the dependency map.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Breaks directly</h3>
                <FeatureLinks ids={ripple.breaksDirectly} map={map.data} orgSlug={orgSlug} hubId={hubId} empty="Nothing else needs this feature." tone="border-destructive/40 bg-destructive/10" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Breaks next</h3>
                <FeatureLinks ids={ripple.breaksNext} map={map.data} orgSlug={orgSlug} hubId={hubId} empty="No knock-on effects." tone="border-warning/40 bg-warning/10" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-medium">It relies on</h3>
                <FeatureLinks ids={ripple.reliesOn} map={map.data} orgSlug={orgSlug} hubId={hubId} empty="Nothing. This is a foundation." tone="border-success/40 bg-success/10" />
              </div>
              <Link href={qaHref(orgSlug, "insights", hubId, { feature: feature.id })} className="inline-block text-sm text-primary hover:underline">
                See it on the map
              </Link>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What it does</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label htmlFor="feature-description" className="sr-only">
                What it does
              </label>
              <textarea
                id="feature-description"
                rows={5}
                value={text}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Describe it the way you would to a customer."
              />
              <Button size="sm" disabled={description === null || saving} onClick={() => save({ description: text }, "Description saved")}>
                Save
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1.5">
                <label htmlFor="feature-area" className="text-sm font-medium">
                  Area
                </label>
                <select
                  id="feature-area"
                  value={feature.areaId ?? ""}
                  disabled={saving}
                  onChange={(e) => save({ areaId: e.target.value || null }, "Area changed")}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Not in an area</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                Show on the public feature page
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={feature.public}
                  disabled={saving}
                  onChange={(e) => save({ public: e.target.checked }, e.target.checked ? "Now public" : "No longer public")}
                />
              </label>
            </CardContent>
          </Card>

          {(feature.specLinks.length > 0 || feature.codeRefs.length > 0) && (
            <Card>
              <CardContent className="space-y-3 pt-6 text-sm">
                {feature.specLinks.length > 0 && (
                  <div>
                    <div className="font-medium">Spec</div>
                    <div className="text-muted-foreground">{feature.specLinks.join(" · ")}</div>
                  </div>
                )}
                {feature.codeRefs.length > 0 && (
                  <div>
                    <div className="font-medium">Built in</div>
                    <ul className="break-all font-mono text-xs text-muted-foreground">
                      {feature.codeRefs.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
