"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { LayoutGrid } from "lucide-react";
import type { PublicHub } from "@saas/contracts/qa";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ZodForm } from "@/components/ui/zod-form";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";

const hubSchema = z.object({
  name: z.string().min(2).max(120),
  stageUrl: z.string().url().or(z.literal("")).optional(),
  prodUrl: z.string().url().or(z.literal("")).optional(),
});

/**
 * Resolves the organization's hub for the QA pages. QA1 has one hub per product;
 * an organization with several sees the first and can switch with `?hub=`.
 * With none, it offers to create one — the first thing a PM does.
 */
export function HubScope({ orgId, children }: { orgId: string; children: (hub: PublicHub, hubs: PublicHub[]) => React.ReactNode }) {
  const { client } = useSession();
  const { toast } = useToast();
  const hubs = useApiQuery(qk.qaHubs(orgId), () => wrap(async () => (await client.qa.listHubs(orgId)).hubs));
  const [open, setOpen] = React.useState(false);
  const wanted = useSearchParams()?.get("hub") ?? null;

  if (hubs.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-96" />
      </div>
    );
  }
  if (hubs.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">{hubs.error.code}</CardTitle>
          <CardDescription>{hubs.error.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const list = hubs.data ?? [];
  const hub = list.find((h) => h.id === wanted) ?? list[0];
  if (hub) return <>{children(hub, list)}</>;

  return (
    <>
      <EmptyState
        icon={LayoutGrid}
        title="Set up your product"
        description="A hub holds every feature of one product, the scenarios that prove each works, and how they depend on each other."
        primaryAction={{ label: "Create hub", onClick: () => setOpen(true) }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create hub</DialogTitle>
            <DialogDescription>Name the product. The stage address is where scenarios will run.</DialogDescription>
          </DialogHeader>
          <ZodForm
            schema={hubSchema}
            defaultValues={{ name: "", stageUrl: "", prodUrl: "" }}
            fields={[
              { name: "name", label: "Product name", placeholder: "Orun QA" },
              { name: "stageUrl", label: "Stage address", placeholder: "https://stage.example.com" },
              { name: "prodUrl", label: "Production address", placeholder: "https://example.com" },
            ]}
            submitLabel="Create"
            cancel={{ label: "Cancel", onClick: () => setOpen(false) }}
            onSubmit={async (v) => {
              const r = await wrap(async () =>
                (await client.qa.createHub(orgId, { name: v.name, stageUrl: v.stageUrl || null, prodUrl: v.prodUrl || null })).hub,
              );
              if (!r.ok) {
                toast({ kind: "error", title: "Could not create the hub", description: r.error.message });
                return;
              }
              toast({ kind: "success", title: `${r.data.name} is ready` });
              setOpen(false);
              hubs.reload();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A QA link that keeps the current hub, so an organization with several hubs never lands on the wrong one. */
export function qaHref(orgSlug: string, path: string, hubId: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ hub: hubId, ...(extra ?? {}) });
  return `/orgs/${orgSlug}/${path}?${q.toString()}`;
}
