"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCheck, Bug, ClipboardList, FolderKanban, Gauge, LayoutGrid, ListChecks, MessageSquare, Network, Play, Settings, UserRound } from "lucide-react";
import type { PublicArea, PublicFeature, FeatureHealth, PublicResult, PublicScenario } from "@saas/contracts/qa";
import { DEMO_RECORDING, DEMO_RECORDING_MESSAGE, DEMO_RECORDING_TIMINGS } from "./recording.fixture";
import { useSearchParams } from "next/navigation";
import { FeaturesView } from "@/components/qa/features-view";
import { FeatureView } from "@/components/qa/feature-view";
import { TestsView } from "@/components/qa/tests-view";

/**
 * /demo/qa — a token-free preview of the Orun QA screens with the design
 * canvas's own sample data, for side-by-side visual checks against the canvas.
 * Mock data only; nothing here reaches the API.
 */

const AREAS: PublicArea[] = [
  { id: "area_1", hubId: "hub_demo", name: "Workspace & people", position: 0 },
  { id: "area_2", hubId: "hub_demo", name: "Projects & tasks", position: 1 },
  { id: "area_3", hubId: "hub_demo", name: "Plans & billing", position: 2 },
  { id: "area_4", hubId: "hub_demo", name: "Updates & insight", position: 3 },
];

const F: [string, string, FeatureHealth, string][] = [
  ["area_1", "Sign in with your company account", "verified", "Teammates sign in with the company login. No new password to remember."],
  ["area_1", "Invite teammates", "attention", "Send an invite by email. They join with the right role already set."],
  ["area_1", "Roles and permissions", "verified", "Owners, admins and members each see only what they should."],
  ["area_2", "Create a project", "verified", "Start a project with a name, a team and an empty board."],
  ["area_2", "Archive a project", "broken", "Put a finished project away. Its tasks stay readable but locked."],
  ["area_2", "Task board", "attention", "Drag tasks between columns. Everyone sees the change live."],
  ["area_2", "Move many tasks at once", "verified", "Select a batch of tasks and move them to another board."],
  ["area_3", "Choose a plan", "verified", "Compare plans and upgrade with a card in under a minute."],
  ["area_3", "Change the number of seats", "not_tested", "New this week. Add or remove seats; the next invoice adjusts."],
  ["area_3", "Invoices", "verified", "Every invoice matches what the customer was told they would pay."],
  ["area_4", "Activity feed", "attention", "A running history of what happened in each project."],
  ["area_4", "Weekly digest email", "verified", "A Monday summary for each member. Easy to switch off."],
  ["area_4", "Live build preview", "verified", "See a build take shape as you type, and come back to it later."],
];

const FEATURES: PublicFeature[] = F.map(([areaId, name, health, description], i) => ({
  id: `feat_${String(i).padStart(32, "0")}`,
  hubId: "hub_demo",
  areaId,
  name,
  description,
  ownerUserId: null,
  qaUserId: null,
  public: false,
  codeRefs: [],
  specLinks: [],
  health,
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
}));

function Rail() {
  const link = (Icon: React.ComponentType<{ "aria-hidden"?: boolean }>, label: string, on = false) => (
    <a className={on ? "nav on" : "nav"} href="#rail">
      <Icon aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </a>
  );
  return (
    <aside className="qa qa-rail flex w-[272px] shrink-0 flex-col" style={{ minHeight: "100vh" }}>
      <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-[22px]">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#171717] font-display text-base font-semibold text-[#C39B45]">O</span>
        <span className="flex flex-col leading-tight">
          <span style={{ fontWeight: 700, fontSize: 15 }}>orun-console</span>
          <span style={{ fontSize: 12, color: "#6E6E68" }}>Orun QA · product hub</span>
        </span>
      </div>
      <nav className="flex flex-col gap-0.5 px-3 pb-4">
        <Link href="#rail" className="btn primary qa-agent-btn">
          <MessageSquare aria-hidden="true" />
          Ask the agent
        </Link>
        <div className="railh">Product</div>
        {link(LayoutGrid, "Features", true)}
        {link(CheckCheck, "Reviews")}
        {link(Bug, "Bugs")}
        {link(Network, "Insights")}
        <div className="railh">Testing</div>
        {link(ListChecks, "Plan scenarios")}
        {link(ClipboardList, "All tests")}
        {link(Play, "Try a scenario")}
        {link(UserRound, "Scenario desk")}
        <div className="railh">Workspace</div>
        {link(FolderKanban, "Projects")}
        {link(Gauge, "Usage & quota")}
        {link(Settings, "Settings")}
      </nav>
    </aside>
  );
}

const AT = "2026-10-05T10:41:00.000Z";
const demoResult = (id: string, scenarioId: string, verdict: PublicResult["verdict"], extra: Partial<PublicResult> = {}): PublicResult => ({
  id,
  runId: "run_demo",
  scenarioId,
  featureId: FEATURES[4]!.id,
  verdict,
  failingStep: null,
  message: "",
  durationMs: 4200,
  stepTimings: [],
  apiCalls: [],
  recordingId: null,
  createdAt: AT,
  ...extra,
});
const RECORDED = demoResult("res_1", "scn_1", "fails", { failingStep: 2, message: DEMO_RECORDING_MESSAGE, stepTimings: DEMO_RECORDING_TIMINGS, recordingId: "rec_demo", durationMs: 15200 });
const demoScenario = (id: string, name: string, expected: string, last: PublicResult | null, state: PublicScenario["state"] = "approved"): PublicScenario => ({
  id,
  hubId: "hub_demo",
  featureId: FEATURES[4]!.id,
  name,
  expected,
  kind: "screens_apis",
  cadence: "daily",
  state,
  asRole: null,
  steps:
    id === "scn_1"
      ? [
          { ord: 0, text: "Open the sign-in page", action: { type: "goto", path: "/login" } },
          { ord: 1, text: "It asks you to sign in", action: { type: "expect_text", text: "Sign in" } },
          { ord: 2, text: "Your company login is offered", action: { type: "expect_text", text: "Continue with your company account" } },
        ]
      : [],
  last,
  createdAt: AT,
  updatedAt: AT,
});
const SCENARIOS: PublicScenario[] = [
  demoScenario("scn_1", "Sign in offers the company login", "The sign-in page offers the company account first", RECORDED),
  demoScenario("scn_2", "Archive an empty project", "It disappears from the list and shows under Archived", demoResult("res_2", "scn_2", "works")),
  demoScenario("scn_3", "Bring an archived project back", "Everything returns exactly as it was", demoResult("res_3", "scn_3", "works")),
  demoScenario("scn_4", "A member who is not an owner cannot archive", "They do not see the option at all", null, "draft"),
];
const HISTORY: PublicResult[] = [RECORDED, ...Array.from({ length: 13 }, (_, i) => demoResult(`res_h${i}`, "scn_1", "works", { createdAt: new Date(Date.parse(AT) - (i + 1) * 86400000).toISOString() }))];

export default function QaDemoPage() {
  const [picked, setPicked] = React.useState("scn_1");
  const view = useSearchParams()?.get("view");
  // Sample data only: never shown in a deployed console unless explicitly enabled.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_QA_DEMO !== "1") {
    return <p style={{ padding: 32 }}>Not available.</p>;
  }
  return (
    <div className="flex min-h-screen bg-background">
      <Rail />
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-8 pb-16 pt-8">
        {view === "tests" ? (
          <TestsView
            scenarios={SCENARIOS.map((s) =>
              s.id === "scn_2"
                ? {
                    ...s,
                    steps: [
                      { ord: 0, text: "Open an empty project", action: { type: "goto", path: "/projects/empty" } },
                      { ord: 1, text: "Choose Archive and confirm", action: { type: "click", text: "Archive" } },
                      { ord: 2, text: "Archive the project", action: { type: "expect_response", method: "POST", path: "/projects/{id}/archive", status: 202 } },
                    ],
                    last: s.last && { ...s.last, apiCalls: [{ method: "POST", path: "/projects/p1/archive", status: 202, ms: 160 }] },
                  }
                : s,
            )}
            features={FEATURES}
            lastRun={{ id: "run_demo", hubId: "hub_demo", trigger: "schedule", env: "stage", ref: null, status: "failed", startedAt: AT, finishedAt: AT }}
            recordingHref={() => "/demo/qa?view=feature"}
            tryHref="#"
            agentHref="#"
          />
        ) : view === "feature" ? (
          <FeatureView
            feature={{ ...FEATURES[4]!, specLinks: ["LIN-498"], ownerUserId: "Rahul", qaUserId: "Priya" }}
            ripple={{ feature: FEATURES[4]!.id, reliesOn: [FEATURES[3]!.id], breaksDirectly: [FEATURES[5]!.id, FEATURES[10]!.id], breaksNext: [FEATURES[11]!.id] }}
            areas={AREAS}
            names={Object.fromEntries(FEATURES.map((f) => [f.id, f.name]))}
            featuresHref="#"
            featureHref={() => "#"}
            insightsHref="#"
            scenarios={SCENARIOS}
            selectedScenarioId={picked}
            onSelectScenario={setPicked}
            history={picked === "scn_1" ? HISTORY : []}
            loadRecording={async () => DEMO_RECORDING}
            onApprove={async () => undefined}
          />
        ) : (
        <FeaturesView
          productName="Product"
          features={FEATURES}
          areas={AREAS}
          needsYou={[
            { kind: "warn", label: "Sign off", text: "Release 2.10 is ready for your review before production", href: "#" },
            { kind: "bad", label: "Broken", text: "Archive a project stopped working after this morning's release", href: "#" },
            { kind: "warn", label: "Bug", text: "A customer reports invite emails arriving late", href: "#" },
            { kind: "info", label: "Review", text: "Priya added 4 scenarios for Change seats", href: "#" },
          ]}
          lastCheck="today, 09:12"
          featureHref={() => "#"}
          planHref="#"
          testsHref="#"
          showAddScenario
        />
        )}
      </main>
    </div>
  );
}
