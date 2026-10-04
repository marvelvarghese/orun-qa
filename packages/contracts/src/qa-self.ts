import type { FeatureManifest } from "./qa.js";

/**
 * Orun QA's own features — the default workspace's hub tests Orun QA itself.
 * Only what exists today; each milestone adds its own features here as it ships,
 * and re-importing is safe (idempotent by name).
 */
export const ORUN_QA_SELF: FeatureManifest = {
  areas: [
    { name: "Workspace & people", position: 0 },
    { name: "The feature map", position: 1 },
  ],
  features: [
    {
      name: "Sign in",
      area: "Workspace & people",
      description: "Get into Orun QA with your email; your session keeps you signed in.",
      codeRefs: ["apps/identity-worker", "apps/web-console-next/src/app/login"],
    },
    {
      name: "Workspaces and members",
      area: "Workspace & people",
      description: "Each product team works in its own workspace; owners invite people and give them roles.",
      codeRefs: ["apps/membership-worker", "apps/policy-worker"],
    },
    {
      name: "Hubs",
      area: "The feature map",
      description: "A hub holds every feature of one product. A workspace's first hub is Orun QA itself.",
      codeRefs: ["apps/qa-worker/src/handlers.ts", "apps/web-console-next/src/components/qa/hub-scope.tsx"],
      specLinks: ["QA-2"],
    },
    {
      name: "Areas and features",
      area: "The feature map",
      description: "Group features into product areas and describe each one the way a customer would.",
      codeRefs: ["packages/db/src/qa", "apps/qa-worker/src/handlers.ts"],
      specLinks: ["QA-2"],
    },
    {
      name: "Features home",
      area: "The feature map",
      description: "Every feature at a glance: health, filters, and cards grouped by area.",
      codeRefs: ["apps/web-console-next/src/components/qa/features-view.tsx"],
      specLinks: ["QA-3", "QA-5"],
    },
    {
      name: "Feature page",
      area: "The feature map",
      description: "One feature: what it does, its recording, its scenarios, and what breaks with it.",
      codeRefs: ["apps/web-console-next/src/components/qa/feature-view.tsx"],
      specLinks: ["QA-3", "QA-6"],
    },
    {
      name: "Dependency links",
      area: "The feature map",
      description: "Say which feature needs which. The PM confirms links that QA or the agent propose.",
      codeRefs: ["apps/qa-worker/src/handlers.ts", "packages/contracts/src/qa.ts"],
      specLinks: ["QA-2", "QA-4"],
    },
    {
      name: "Insights map",
      area: "The feature map",
      description: "The dependency map: click a feature to see what it relies on and what breaks with it.",
      codeRefs: ["apps/web-console-next/src/app/(app)/orgs/[orgSlug]/insights/page.tsx", "apps/web-console-next/src/lib/qa-map-layout.ts"],
      specLinks: ["QA-3", "QA-6"],
    },
  ],
  edges: [
    { from: "Sign in", to: "Workspaces and members" },
    { from: "Workspaces and members", to: "Hubs" },
    { from: "Hubs", to: "Areas and features" },
    { from: "Areas and features", to: "Features home" },
    { from: "Areas and features", to: "Feature page" },
    { from: "Areas and features", to: "Dependency links" },
    { from: "Dependency links", to: "Feature page" },
    { from: "Dependency links", to: "Insights map" },
  ],
};
