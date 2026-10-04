"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import type { PublicHub } from "@saas/contracts/qa";
import { ORUN_QA_SELF } from "@saas/contracts/qa-self";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ZodForm } from "@/components/ui/zod-form";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";

// Orun QA's own deployment — the addresses its scenarios will run against.
const ORUN_QA_STAGE_URL = "https://orun-qa-web-console-next-stage.rahulvarghesepullely.workers.dev";
const ORUN_QA_PROD_URL = "https://orun-qa-web-console-next-prod.rahulvarghesepullely.workers.dev";

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
  const [busy, setBusy] = React.useState(false);
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

  const setUpSelf = async () => {
    setBusy(true);
    const r = await wrap(async () => {
      const { hub } = await client.qa.createHub(orgId, { name: "Orun QA", slug: "orun-qa", stageUrl: ORUN_QA_STAGE_URL, prodUrl: ORUN_QA_PROD_URL });
      const { result } = await client.qa.importManifest(orgId, hub.id, ORUN_QA_SELF);
      return result;
    });
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not set up the hub", description: r.error.code === "not_found" ? "Only a workspace owner or admin can set up a hub." : r.error.message });
      return;
    }
    toast({ kind: "success", title: `Orun QA now tests itself · ${r.data.features.created} features` });
    hubs.reload();
  };

  return (
    <>
      <div className="qa">
        <div className="eyebrow">Get started</div>
        <h1 className="serif" style={{ margin: "6px 0 8px", fontSize: 40, fontWeight: 500, lineHeight: 1.15 }}>
          Set up your product
        </h1>
        <p className="muted" style={{ margin: "0 0 24px", fontSize: 16, maxWidth: 720 }}>
          A hub holds every feature of one product, the scenarios that prove each works, and how they depend on each other.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 16 }}>
          <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 10, background: "#171717", color: "#FFFFFF", borderColor: "#171717" }}>
            <div className="eyebrow" style={{ color: "#C9C4B8" }}>
              Recommended
            </div>
            <div className="serif" style={{ fontSize: 24 }}>
              Orun QA, testing itself
            </div>
            <p style={{ margin: 0, color: "#D6D2C8", fontSize: 14 }}>
              Start with this product&rsquo;s own {ORUN_QA_SELF.features.length} features and the links between them. Every new Orun QA feature joins this hub as it ships.
            </p>
            <div>
              <button type="button" className="btn gold" onClick={setUpSelf} disabled={busy}>
                {busy ? "Setting up…" : "Set up Orun QA's own hub"}
              </button>
            </div>
          </div>
          <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="eyebrow">Another product</div>
            <div className="serif" style={{ fontSize: 24 }}>
              A hub for your product
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Name it and give its stage address. You add its features, or import them from a manifest.
            </p>
            <div>
              <button type="button" className="btn" onClick={() => setOpen(true)}>
                Create a hub
              </button>
            </div>
          </div>
        </div>
      </div>
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
