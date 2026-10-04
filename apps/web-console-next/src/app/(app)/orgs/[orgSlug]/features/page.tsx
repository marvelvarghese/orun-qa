"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { z } from "zod";
import { Plus, LayoutGrid, Film } from "lucide-react";
import type { FeatureHealth, PublicFeature } from "@saas/contracts/qa";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref } from "@/components/qa/hub-scope";
import { HealthBadge, HealthBar, HEALTH_LABEL, HEALTH_ORDER } from "@/components/qa/health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ZodForm } from "@/components/ui/zod-form";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { cn } from "@/lib/cn";

const featureSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
});

export default function FeaturesPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return (
    <OrgScope slug={slug}>
      {(org) => (
        <HubScope orgId={org.id}>
          {(hub) => <Inner orgId={org.id} orgSlug={org.slug} hubId={hub.id} hubName={hub.name} />}
        </HubScope>
      )}
    </OrgScope>
  );
}

function Inner({ orgId, orgSlug, hubId, hubName }: { orgId: string; orgSlug: string; hubId: string; hubName: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const [filter, setFilter] = React.useState<FeatureHealth | "all">("all");
  const [open, setOpen] = React.useState(false);

  const features = map.data?.features ?? [];
  const areas = map.data?.areas ?? [];
  const counts = HEALTH_ORDER.reduce(
    (acc, h) => ({ ...acc, [h]: features.filter((f) => f.health === h).length }),
    {} as Record<FeatureHealth, number>,
  );
  const shown = features.filter((f) => filter === "all" || f.health === filter);
  const groups: { id: string | null; name: string; items: PublicFeature[] }[] = [
    ...areas.map((a) => ({ id: a.id as string | null, name: a.name, items: shown.filter((f) => f.areaId === a.id) })),
    { id: null, name: "Not in an area yet", items: shown.filter((f) => !f.areaId || !areas.some((a) => a.id === f.areaId)) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {hubName} · {features.length} features
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Every feature, shown working.</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Each feature is checked and recorded the way a customer would use it. What you see here is what works today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={qaHref(orgSlug, "insights", hubId)}>How they connect</Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-1.5 h-4 w-4" />
                New feature
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a feature</DialogTitle>
                <DialogDescription>Describe it the way you would to a customer.</DialogDescription>
              </DialogHeader>
              <ZodForm
                schema={featureSchema}
                defaultValues={{ name: "", description: "" }}
                fields={[
                  { name: "name", label: "Name", placeholder: "Archive a project" },
                  {
                    name: "description",
                    label: "What it does",
                    placeholder: "Put a finished project away. Its tasks stay readable but locked.",
                  },
                ]}
                submitLabel="Add"
                cancel={{ label: "Cancel", onClick: () => setOpen(false) }}
                onSubmit={async (v) => {
                  const r = await wrap(
                    async () => (await client.qa.createFeature(orgId, hubId, { name: v.name, description: v.description ?? "" })).feature,
                  );
                  if (!r.ok) {
                    toast({ kind: "error", title: "Could not add the feature", description: r.error.message });
                    return;
                  }
                  toast({ kind: "success", title: `${r.data.name} added` });
                  setOpen(false);
                  map.reload();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <HealthBar counts={counts} />

      {features.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by health">
          {(["all", ...HEALTH_ORDER] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setFilter(h)}
              aria-pressed={filter === h}
              className={cn(
                "h-9 rounded-full border px-3 text-sm transition-colors",
                filter === h ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
            >
              {h === "all" ? `All · ${features.length}` : `${HEALTH_LABEL[h]} · ${counts[h]}`}
            </button>
          ))}
        </div>
      )}

      {map.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="aspect-[16/10] w-full" />
                <Skeleton className="mt-3 h-4 w-40" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : map.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{map.error.code}</CardTitle>
            <CardDescription>{map.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : features.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No features yet"
          description="Add the things a customer can do. Each one gets scenarios, a recording, and its place on the map."
          primaryAction={{ label: "Add a feature", onClick: () => setOpen(true) }}
        />
      ) : (
        groups.map((g) => (
          <section key={g.id ?? "none"} className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">{g.name}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((f) => (
                <Link key={f.id} href={qaHref(orgSlug, `features/${f.id}`, hubId)} className="group block">
                  <Card className="h-full overflow-hidden transition-shadow group-hover:border-primary/40 group-hover:shadow-md">
                    <div className="m-2 flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-lg bg-muted text-center text-xs text-muted-foreground">
                      <Film className="h-5 w-5" aria-hidden="true" />
                      Recording appears after the first verified run
                    </div>
                    <CardHeader className="pt-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{f.name}</CardTitle>
                        <HealthBadge health={f.health} />
                      </div>
                      {f.description && <CardDescription className="line-clamp-2">{f.description}</CardDescription>}
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      {f.specLinks.length > 0 ? f.specLinks.join(" · ") : "No spec linked"}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
