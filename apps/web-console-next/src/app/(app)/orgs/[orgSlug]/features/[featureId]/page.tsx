"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref } from "@/components/qa/hub-scope";
import { FeatureView, type FeaturePatch } from "@/components/qa/feature-view";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import type { PublicScenario } from "@saas/contracts/qa";

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

function Inner({ orgId, orgSlug, hubId, featureId }: { orgId: string; orgSlug: string; hubId: string; featureId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const detail = useApiQuery(qk.qaFeature(orgId, hubId, featureId), () => wrap(() => client.qa.getFeature(orgId, hubId, featureId)));
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const scenarios = useApiQuery(qk.qaScenarios(orgId, hubId, featureId), () => wrap(async () => (await client.qa.listScenarios(orgId, hubId, { feature: featureId })).scenarios));
  // "Watch the recording" from All tests names the scenario to open.
  const [picked, setPicked] = React.useState<string | null>(useSearchParams()?.get("scenario") ?? null);
  // Show the scenario that needs attention first: a failing one, else the first recorded one.
  const list = scenarios.data ?? [];
  // A ?scenario= from elsewhere counts only if it is one of this feature's.
  const pickedOk = picked && list.some((s) => s.id === picked) ? picked : null;
  const fallback = list.find((s) => s.state === "approved" && s.last && s.last.verdict !== "works")?.id ?? list.find((s) => s.last?.recordingId)?.id ?? list[0]?.id ?? null;
  // Settle the default once, so a background refresh never switches the scenario under the viewer.
  React.useEffect(() => {
    if (!pickedOk && fallback) setPicked(fallback);
  }, [pickedOk, fallback]);
  const selectedId = pickedOk ?? fallback;
  const scenario = useApiQuery(
    qk.qaScenario(orgId, hubId, selectedId ?? "none"),
    () => wrap(() => client.qa.getScenario(orgId, hubId, selectedId!)),
    { enabled: selectedId !== null },
  );

  if (detail.loading) {
    return (
      <div className="qa">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-10 w-80" />
        <Skeleton className="mt-6 aspect-[16/10] w-full max-w-3xl rounded-2xl" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="qa card" style={{ padding: 24 }}>
        <div style={{ fontWeight: 700, color: "#A33A35" }}>{detail.error?.code ?? "not_found"}</div>
        <div className="muted">{detail.error?.message ?? "This feature does not exist."}</div>
      </div>
    );
  }

  const { feature, ripple } = detail.data;
  const names = Object.fromEntries((map.data?.features ?? []).map((f) => [f.id, f.name]));

  const onSave = async (patch: FeaturePatch, label: string) => {
    const r = await wrap(async () => (await client.qa.updateFeature(orgId, hubId, feature.id, patch)).feature);
    if (!r.ok) {
      toast({
        kind: "error",
        title: "Not saved",
        description: r.error.code === "not_found" ? "Only the product owner can change a feature." : r.error.message,
      });
      return false;
    }
    toast({ kind: "success", title: label });
    detail.reload();
    void qc.invalidateQueries({ queryKey: qk.qaMap(orgId, hubId) });
    return true;
  };

  const loadRecording = async (recordingId: string) => (await client.qa.getRecording(orgId, hubId, recordingId)).recording.events;

  const onApprove = async (sc: PublicScenario) => {
    const r = await wrap(async () => (await client.qa.approveScenario(orgId, hubId, sc.id, { updatedAt: sc.updatedAt })).scenario);
    if (!r.ok) {
      toast({
        kind: "error",
        title: "Not approved",
        description:
          r.error.code === "not_found" ? "Only the product owner can approve a scenario." : r.error.code === "conflict" ? "It changed since you opened it. Look again, then approve." : r.error.message,
      });
      scenarios.reload();
      return;
    }
    toast({ kind: "success", title: "Approved", description: "It now counts toward this feature's health." });
    void qc.invalidateQueries({ queryKey: ["qa", "scenarios", orgId, hubId] });
    void qc.invalidateQueries({ queryKey: qk.qaScenario(orgId, hubId, sc.id) });
  };

  return (
    <FeatureView
      feature={feature}
      ripple={ripple}
      areas={map.data?.areas ?? []}
      names={names}
      featuresHref={qaHref(orgSlug, "features", hubId)}
      featureHref={(id) => qaHref(orgSlug, `features/${id}`, hubId)}
      insightsHref={qaHref(orgSlug, "insights", hubId, { feature: feature.id })}
      onSave={onSave}
      scenarios={scenarios.loading ? null : list}
      selectedScenarioId={selectedId}
      onSelectScenario={setPicked}
      history={scenario.data?.scenario.id === selectedId ? scenario.data.history : []}
      loadRecording={loadRecording}
      onApprove={onApprove}
    />
  );
}
