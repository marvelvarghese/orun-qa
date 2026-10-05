import { describe as group, expect, it } from "vitest";
import { exitCode, fillPath, findCall, matchPath, pathOf, type PathVars } from "./plan.js";
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
