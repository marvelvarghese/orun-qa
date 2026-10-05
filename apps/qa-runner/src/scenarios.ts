// Orun QA's own scenarios: the product checking itself on its own stage. They
// live in the repository, so code review is their approval; the runner writes
// any that are missing or changed into the self hub and approves them.

import type { CreateScenarioRequest } from "@saas/contracts/qa";

export interface DeclaredScenario extends Omit<CreateScenarioRequest, "featureId"> {
  /** The feature it proves, by name, from ORUN_QA_SELF. */
  feature: string;
}

const MAP_CALL = "/v1/organizations/{orgId}/qa/hubs/{hub}/map";
const FEATURES_HOME = "/orgs/{org}/features?hub={hub}";

export const ORUN_QA_SELF_SCENARIOS: DeclaredScenario[] = [
  {
    feature: "Features home",
    name: "Opens the features home with every area",
    expected: "The features home lists the product's areas and features from the map.",
    steps: [
      { text: "Open the features home", action: { type: "goto", path: "/orgs/{org}/features?hub={hub}" } },
      { text: "The page asks to see every feature working", action: { type: "expect_visible", role: "heading", text: "Every feature, shown working." } },
      { text: "The map was read", action: { type: "expect_response", method: "GET", path: MAP_CALL, status: 200 } },
      { text: "The first area is listed", action: { type: "expect_visible", role: "heading", text: "Workspace & people" } },
      { text: "The second area is listed", action: { type: "expect_visible", role: "heading", text: "The feature map" } },
    ],
  },
  {
    feature: "Feature page",
    name: "Opens a feature and shows what breaks with it",
    expected: "A feature's page shows its name and the features affected when it breaks.",
    steps: [
      { text: "Open the Feature page feature", action: { type: "goto", path: "/orgs/{org}/features/{feature:Feature page}?hub={hub}" } },
      { text: "Its name is the heading", action: { type: "expect_visible", role: "heading", text: "Feature page" } },
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
      { text: "The map is drawn", action: { type: "expect_visible", role: "heading", text: "Feature dependency map" } },
    ],
  },
  {
    feature: "Sign in",
    name: "A signed-in visit opens the product, not the sign-in page",
    expected: "With a session, the console goes straight to the product and knows who is signed in.",
    steps: [
      { text: "Open the features home with a session", action: { type: "goto", path: FEATURES_HOME } },
      { text: "It stays on the features home", action: { type: "expect_url", path: "/orgs/{org}/features" } },
      { text: "It knows who is signed in", action: { type: "expect_response", method: "GET", path: "/v1/auth/profile", status: 200 } },
    ],
  },
  {
    feature: "Workspaces and members",
    name: "The workspace opens for its member",
    expected: "A member's workspaces load and the product opens inside theirs.",
    steps: [
      { text: "Open the features home", action: { type: "goto", path: FEATURES_HOME } },
      { text: "The member's workspaces were read", action: { type: "expect_response", method: "GET", path: "/v1/organizations", status: 200 } },
      { text: "The product opens inside the workspace", action: { type: "expect_visible", role: "heading", text: "Every feature, shown working." } },
    ],
  },
  {
    feature: "Hubs",
    name: "Opens Orun QA's own hub",
    expected: "The workspace's hubs load and the features home names the hub it shows.",
    steps: [
      { text: "Open the features home", action: { type: "goto", path: FEATURES_HOME } },
      { text: "The hubs were read", action: { type: "expect_response", method: "GET", path: "/v1/organizations/{orgId}/qa/hubs", status: 200 } },
      { text: "The page names the hub", action: { type: "expect_text", text: "Orun QA ·" } },
    ],
  },
  {
    feature: "Areas and features",
    name: "Lists the features of each area",
    expected: "Every area shows its features as cards.",
    steps: [
      { text: "Open the features home", action: { type: "goto", path: FEATURES_HOME } },
      { text: "The map was read", action: { type: "expect_response", method: "GET", path: MAP_CALL, status: 200 } },
      { text: "An area is a heading", action: { type: "expect_visible", role: "heading", text: "The feature map" } },
      { text: "Its features are listed", action: { type: "expect_text", text: "Dependency links" } },
    ],
  },
  {
    feature: "Dependency links",
    name: "Shows what a feature relies on",
    expected: "A feature's page lists the features it relies on, from the confirmed links.",
    steps: [
      { text: "Open the Dependency links feature", action: { type: "goto", path: "/orgs/{org}/features/{feature:Dependency links}?hub={hub}" } },
      { text: "The feature was read", action: { type: "expect_response", method: "GET", path: "/v1/organizations/{orgId}/qa/hubs/{hub}/features/{feature:Dependency links}", status: 200 } },
      { text: "What it relies on is shown", action: { type: "expect_visible", role: "heading", text: "It relies on" } },
    ],
  },
];
