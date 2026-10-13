"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicTry, TryRole } from "@saas/contracts/qa";
import { OrgScope } from "@/components/shell/org-scope";
import { HubScope, qaHref } from "@/components/qa/hub-scope";
import { TryView } from "@/components/qa/try-view";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";

export default function TryPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return (
    <OrgScope slug={slug}>
      {(org) => <HubScope orgId={org.id}>{(hub) => <Inner orgId={org.id} orgSlug={org.slug} hubId={hub.id} hubSlug={hub.slug} />}</HubScope>}
    </OrgScope>
  );
}

/** While a try waits or runs, look again this often. */
const POLL_MS = 3000;

function Inner({ orgId, orgSlug, hubId, hubSlug }: { orgId: string; orgSlug: string; hubId: string; hubSlug: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const map = useApiQuery(qk.qaMap(orgId, hubId), () => wrap(() => client.qa.getMap(orgId, hubId)));
  const recent = useApiQuery(qk.qaTries(orgId, hubId), () => wrap(async () => (await client.qa.listTries(orgId, hubId)).tries));
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [startingNow, setStartingNow] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [current, setCurrent] = React.useState<PublicTry | null>(null);

  // Open on the newest try until the person picks or asks one.
  const shownId = currentId ?? recent.data?.[0]?.id ?? null;

  // Follow the shown try; poll while it waits or runs.
  React.useEffect(() => {
    if (!shownId) {
      setCurrent(null);
      return;
    }
    let stopped = false;
    let timer: number | null = null;
    const look = async () => {
      const r = await wrap(async () => (await client.qa.getTry(orgId, hubId, shownId)).try);
      if (stopped) return;
      if (r.ok) {
        setCurrent(r.data);
        if (r.data.status === "queued" || r.data.status === "running") timer = window.setTimeout(look, POLL_MS);
        else void qc.invalidateQueries({ queryKey: qk.qaTries(orgId, hubId) });
      }
    };
    void look();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [shownId, client, orgId, hubId, qc]);

  const onAsk = async (question: string, asRole: TryRole, featureId: string | null) => {
    setAsking(true);
    const r = await wrap(() => client.qa.createTry(orgId, hubId, { question, asRole, featureId }));
    setAsking(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Not asked", description: r.error.code === "not_found" ? "Trying needs a role that can run checks." : r.error.message });
      return;
    }
    setStartingNow(r.data.dispatched || r.data.queuedBehind);
    setCurrent(r.data.try);
    setCurrentId(r.data.try.id);
    void qc.invalidateQueries({ queryKey: qk.qaTries(orgId, hubId) });
  };

  const onSave = async (t: PublicTry, featureId: string, name: string) => {
    const r = await wrap(() => client.qa.saveTry(orgId, hubId, t.id, { featureId, name }));
    if (!r.ok) {
      toast({
        kind: "error",
        title: "Not saved",
        description: r.error.code === "not_found" ? "Saving needs a role that writes scenarios." : r.error.message,
      });
      return false;
    }
    setCurrent(r.data.try);
    toast({ kind: "success", title: "Saved as a draft scenario", description: "Approve it on the feature's page and it runs every day." });
    void qc.invalidateQueries({ queryKey: ["qa", "scenarios", orgId, hubId] });
    void qc.invalidateQueries({ queryKey: qk.qaTries(orgId, hubId) });
    return true;
  };

  const loadRecording = React.useCallback(async (tryId: string) => (await client.qa.getTryRecording(orgId, hubId, tryId)).recording.events, [client, orgId, hubId]);

  return (
    <TryView
      features={map.data?.features ?? []}
      recent={recent.data ?? []}
      current={current}
      startingNow={startingNow}
      asking={asking}
      onAsk={onAsk}
      onPick={(id) => {
        setStartingNow(false);
        setCurrentId(id);
      }}
      onSave={onSave}
      loadRecording={loadRecording}
      agentHref={qaHref(orgSlug, "agent", hubId)}
      // The runner answers tries for Orun QA's own hub.
      available={hubSlug === "orun-qa"}
    />
  );
}
