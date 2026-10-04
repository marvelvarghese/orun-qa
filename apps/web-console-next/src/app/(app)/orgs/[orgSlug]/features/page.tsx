"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { z } from "zod";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref, setUpSelfHub } from "@/components/qa/hub-scope";
import { FeaturesView } from "@/components/qa/features-view";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ZodForm } from "@/components/ui/zod-form";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";

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
          {(hub) => <Inner orgId={org.id} orgSlug={org.slug} hubId={hub.id} hubName={hub.name} hubSlug={hub.slug} />}
        </HubScope>
      )}
    </OrgScope>
  );
}

function Inner({ orgId, orgSlug, hubId, hubName, hubSlug }: { orgId: string; orgSlug: string; hubId: string; hubName: string; hubSlug: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {map.loading ? (
        <div className="qa">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-12 w-[520px] max-w-full" />
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[16/10] w-full rounded-2xl" />
            ))}
          </div>
        </div>
      ) : map.error ? (
        <div className="qa card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, color: "#A33A35" }}>{map.error.code}</div>
          <div className="muted">{map.error.message}</div>
        </div>
      ) : !map.data ? (
        <div className="qa muted">No feature map to show.</div>
      ) : (
        <FeaturesView
          productName={hubName}
          features={map.data.features}
          areas={map.data.areas}
          needsYou={[
            ...map.data.features
              .filter((f) => f.health === "broken")
              .map((f) => ({ kind: "bad" as const, label: "Broken", text: `${f.name} stopped working`, href: qaHref(orgSlug, `features/${f.id}`, hubId) })),
            ...map.data.features
              .filter((f) => f.health === "attention")
              .map((f) => ({ kind: "warn" as const, label: "Attention", text: `${f.name} needs attention`, href: qaHref(orgSlug, `features/${f.id}`, hubId) })),
          ]}
          lastCheck={null}
          featureHref={(id) => qaHref(orgSlug, `features/${id}`, hubId)}
          planHref={qaHref(orgSlug, "plan", hubId)}
          testsHref={qaHref(orgSlug, "tests", hubId)}
          onAddFeature={() => setOpen(true)}
          onImportSelf={
            hubSlug === "orun-qa"
              ? async () => {
                  const r = await wrap(() => setUpSelfHub(client, orgId));
                  map.reload();
                  if (!r.ok) toast({ kind: "error", title: "Import failed", description: r.error.message });
                  else toast({ kind: "success", title: `Imported · ${r.data.created} new features` });
                }
              : undefined
          }
        />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
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
              { name: "description", label: "What it does", placeholder: "Put a finished project away. Its tasks stay readable but locked." },
            ]}
            submitLabel="Add"
            cancel={{ label: "Cancel", onClick: () => setOpen(false) }}
            onSubmit={async (v) => {
              const r = await wrap(async () => (await client.qa.createFeature(orgId, hubId, { name: v.name, description: v.description ?? "" })).feature);
              if (!r.ok) {
                toast({ kind: "error", title: "Could not add the feature", description: r.error.code === "not_found" ? "Only the product owner can add features." : r.error.message });
                return;
              }
              toast({ kind: "success", title: `${r.data.name} added` });
              setOpen(false);
              map.reload();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
