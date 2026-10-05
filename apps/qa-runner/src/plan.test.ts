import { describe as group, expect, it } from "vitest";
import { exitCode, fillPath, findCall, matchPath, pathOf, sameScenario, type PathVars } from "./plan.js";
import { withMarkers } from "./browser.js";
import { ORUN_QA_SELF_SCENARIOS } from "./scenarios.js";
import { ORUN_QA_SELF } from "@saas/contracts/qa-self";
import { RUN_LIMITS, STEP_ACTION_TYPES } from "@saas/contracts/qa";

const vars: PathVars = { org: "personal-usr-1", orgId: "org_1", hub: "hub_1", features: new Map([["feature page", "feat_9"]]) };

group("fillPath", () => {
  it("fills the org, hub and a feature by name", () => {
    expect(fillPath("/orgs/{org}/features/{feature:Feature page}?hub={hub}", vars)).toBe("/orgs/personal-usr-1/features/feat_9?hub=hub_1");
  });
  it("refuses an unknown feature or placeholder", () => {
    expect(() => fillPath("/x/{feature:Nope}", vars)).toThrow(/No feature named "Nope"/);
    expect(() => fillPath("/x/{project}", vars)).toThrow(/Unknown placeholder/);
  });
});

group("API calls", () => {
  it("matches one segment per *", () => {
    expect(matchPath("/v1/organizations/*/qa/hubs/*/map", "/v1/organizations/org_1/qa/hubs/hub_1/map")).toBe(true);
    expect(matchPath("/v1/organizations/*/qa/hubs/*/map", "/v1/organizations/org_1/qa/hubs/map")).toBe(false);
  });
  it("finds the expected call by method, path and status", () => {
    const calls = [
      { method: "GET", path: pathOf("https://api.example/v1/organizations/org_1/qa/hubs/hub_1/map?x=1"), status: 200, ms: 12 },
    ];
    const step = { type: "expect_response" as const, method: "get", path: "/v1/organizations/{orgId}/qa/hubs/{hub}/map", status: 200 };
    expect(findCall(calls, step, vars)).toBeDefined();
    expect(findCall(calls, { ...step, status: 404 }, vars)).toBeUndefined();
  });
});

group("exitCode", () => {
  it("fails the job on any failing or errored scenario", () => {
    expect(exitCode(["works", "skipped"])).toBe(0);
    expect(exitCode(["works", "fails"])).toBe(1);
    expect(exitCode(["errored"])).toBe(1);
  });
});

group("Orun QA's own scenarios", () => {
  const featureNames = new Set(ORUN_QA_SELF.features.map((f) => f.name.toLowerCase()));
  it.each(ORUN_QA_SELF_SCENARIOS.map((s) => [s.name, s] as const))("%s is valid for the worker", (_name, s) => {
    expect(featureNames.has(s.feature.toLowerCase())).toBe(true);
    expect(s.steps.length).toBeGreaterThan(0);
    expect(s.steps.length).toBeLessThanOrEqual(RUN_LIMITS.stepsMax);
    for (const step of s.steps) {
      expect((STEP_ACTION_TYPES as readonly string[]).includes(step.action.type)).toBe(true);
      expect(step.text.length).toBeLessThanOrEqual(RUN_LIMITS.stepTextMax);
      if ("path" in step.action) expect(step.action.path.startsWith("/")).toBe(true);
    }
  });
  it("names are unique", () => {
    const names = ORUN_QA_SELF_SCENARIOS.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

group("sameScenario", () => {
  const declared = { expected: "Draws", steps: [{ text: "Map", action: { type: "expect_response" as const, method: "get", path: "/x", status: 200 } }] };
  it("ignores the key order jsonb returns, and the method's case", () => {
    const stored = { expected: "Draws", steps: [{ text: "Map", action: { path: "/x", type: "expect_response", status: 200, method: "GET" } as never }] };
    expect(sameScenario(stored, declared)).toBe(true);
  });
  it("sees a real change", () => {
    const stored = { expected: "Draws", steps: [{ text: "Map", action: { type: "expect_response" as const, method: "GET", path: "/y", status: 200 } }] };
    expect(sameScenario(stored, declared)).toBe(false);
    expect(sameScenario({ ...declared, expected: "Other" }, declared)).toBe(false);
  });
});

group("withMarkers", () => {
  it("adds step and end marks after the first full snapshot, in time order", () => {
    const raw = [{ type: 4, timestamp: 1000 }, { type: 2, timestamp: 1005 }, { type: 3, timestamp: 1200 }].map((e) => JSON.stringify(e));
    const out = withMarkers(raw, 900, [{ ord: 0, startMs: 0, endMs: 200, ok: true }, { ord: 1, startMs: 250, endMs: 5000, ok: false }], 6000);
    expect(out.map((e) => [e.type, e.timestamp])).toEqual([
      [4, 1000],
      [2, 1005],
      [5, 1005],
      [5, 1150],
      [3, 1200],
      [5, 6900],
    ]);
  });
});
