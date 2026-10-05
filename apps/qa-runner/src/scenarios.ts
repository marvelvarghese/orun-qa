// Orun QA's own scenarios: the product checking itself on its own stage. They
// live in the repository, so code review is their approval; the runner writes
// any that are missing or changed into the self hub and approves them.

import type { CreateScenarioRequest } from "@saas/contracts/qa";

export interface DeclaredScenario extends Omit<CreateScenarioRequest, "featureId"> {
  /** The feature it proves, by name, from ORUN_QA_SELF. */
  feature: string;
}

const MAP_CALL = "/v1/organizations/{orgId}/qa/hubs/{hub}/map";

export const ORUN_QA_SELF_SCENARIOS: DeclaredScenario[] = [
  {
    feature: "Features home",
    name: "Opens the features home with every area",
    expected: "The features home lists the product's areas and features from the map.",
    steps: [
      { text: "Open the features home", action: { type: "goto", path: "/orgs/{org}/features?hub={hub}" } },
      { text: "The page asks to see every feature working", action: { type: "expect_text", text: "Every feature, shown working." } },
      { text: "The map was read", action: { type: "expect_response", method: "GET", path: MAP_CALL, status: 200 } },
      { text: "The first area is listed", action: { type: "expect_text", text: "Workspace & people" } },
      { text: "The second area is listed", action: { type: "expect_text", text: "The feature map" } },
    ],
  },
  {
    feature: "Feature page",
    name: "Opens a feature and shows what breaks with it",
    expected: "A feature's page shows its name and the features affected when it breaks.",
    steps: [
      { text: "Open the Feature page feature", action: { type: "goto", path: "/orgs/{org}/features/{feature:Feature page}?hub={hub}" } },
      { text: "Its name is the heading", action: { type: "expect_visible", text: "Feature page" } },
      { text: "The ripple section is there", action: { type: "expect_text", text: "When this breaks, these are affected" } },
    ],
  },
  {
    feature: "Insights map",
    name: "Draws the dependency map",
    expected: "Insights shows the feature dependency map for the hub.",
    steps: [
      { text: "Open Insights", action: { type: "goto", path: "/orgs/{org}/insights?hub={hub}" } },
      { text: "The heading explains the map", action: { type: "expect_text", text: "How the features lean on each other" } },
      { text: "The map was read", action: { type: "expect_response", method: "GET", path: MAP_CALL, status: 200 } },
      { text: "The map is drawn", action: { type: "expect_text", text: "Feature dependency map" } },
    ],
  },
];
