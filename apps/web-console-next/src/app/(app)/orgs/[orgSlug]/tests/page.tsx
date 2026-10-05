"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref } from "@/components/qa/hub-scope";
import { TestsView } from "@/components/qa/tests-view";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";

export default function TestsPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return (
    <OrgScope slug={slug}>
      {(org) => <HubScope orgId={org.id}>{(hub) => <Inner orgId={org.id} orgSlug={org.slug} hubId={hub.id} />}</HubScope>}
    </OrgScope>
  );
}

function Inner({ orgId, orgSlug, hubId }: { orgId: string; orgSlug: string; hubId: string }) {
  const { client } = useSession();
  const scenarios = useApiQuery(qk.qaScenarios(orgId, hubId), () => wrap(async () => (await client.qa.listScenarios(orgId, hubId)).scenarios));
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const runs = useApiQuery(qk.qaRuns(orgId, hubId), () => wrap(async () => (await client.qa.listRuns(orgId, hubId, { limit: 1 })).runs));

  if (scenarios.loading) {
    return (
      <div className="qa">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-10 w-96" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (scenarios.error || !scenarios.data) {
    return (
      <div className="qa card" style={{ padding: 24 }}>
        <div style={{ fontWeight: 700, color: "#A33A35" }}>{scenarios.error?.code ?? "error"}</div>
        <div className="muted">{scenarios.error?.message ?? "The scenarios could not be loaded."}</div>
      </div>
    );
  }

  return (
    <TestsView
      scenarios={scenarios.data}
      features={map.data?.features ?? []}
      lastRun={runs.data?.[0] ?? null}
      recordingHref={(sc) => qaHref(orgSlug, `features/${sc.featureId}`, hubId, { scenario: sc.id })}
      tryHref={qaHref(orgSlug, "try", hubId)}
      agentHref={qaHref(orgSlug, "agent", hubId)}
    />
  );
}
