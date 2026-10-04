# Epic: orunqa-feature-hub (QA)

**A product manager cannot see, in one place, whether every feature of their product works today. The proof is scattered across CI logs, test files, tickets and people's memory, and none of it is written for a non-developer. Orun QA makes every feature a page with a recording that shows it working, the scenarios and API checks behind that recording, what else depends on it, and the bugs against it. It is its own product — its own repository, workspace and domain — and it connects to a customer's Orunbase workspace as a first-class integration, so it knows their repos, runs, catalog and people without a second setup. The one design idea: the recording is the verdict. A feature is "verified" only when a scenario ran in a real browser on stage and the run left a recording anyone can watch.**

It is for the PM first. QA adds and runs scenarios; developers fix what fails before review; leadership and customers browse the public tour. The map the hub builds — features, their dependencies, the code and APIs behind each — is also served to coding agents over MCP, so they see what a change touches before they make it.

**Orun QA tests itself.** Its own features — the hub, the runner, the planner, the review, the MCP tools — are features in its own hub, connected to its own Orunbase workspace. Its own scenarios verify them on its own stage, its own failures file bugs against it, and its own releases wait on its own release review. Nothing in the product is exempt from the product. An independent heartbeat outside the runner (QA-A) catches the one case self-testing cannot: the tester itself being down.

## Status

| Field | Value |
|-------|-------|
| Status | Draft |
| Cluster | **QA** (QA0–QA5) |
| Owner(s) | `apps/qa-worker` (hubs, features, scenarios, runs, reviews, triage) · `apps/runner-worker` (Playwright on Browser Rendering, recordings in R2) · `apps/mcp-worker` (the QA tool set) · `apps/integrations-worker` (Orunbase, Linear, Jira providers) · `packages/contracts` + `packages/sdk` (the wire) · `apps/web-console-next` (the hub) |
| Builds on | `lumen baseline-v29` — identity, membership, projects, policy, audit, metering, billing, events, webhooks, notifications and integrations are reused as they ship; the QA resource is a new `qa` schema beside them in Supabase Postgres, reached through Hyperdrive |
| Changes | A new product in a new repository (`orun-qa`) and a new Orunbase workspace ("Orun QA"). Orunbase gains nothing it does not already expose: Orun QA uses its public API, OAuth, webhooks, approvals and MCP. |
| Decisions locked | Proposed, awaiting sign-off: (1) **Orun QA is a separate product**: its own repo from the lumen baseline, its own workspace, its own domain and billing. (2) **Orunbase is the deepest integration**: sign in with Orunbase, and a hub connects to one Orunbase workspace to read its catalog, repos and runs, react to its deploys, and gate its production promotion. (3) People and roles are Orun QA's own (lumen membership): PM = admin, QA = member with the QA role. (4) Browser runs happen only on stage, on a schedule with a daily spend cap; pull requests get API checks and an impact note, never a browser. (5) Trackers own their issues; we write forward only, one living comment, never undo a human change. (6) Every verdict carries evidence: a recording or an API trace. (7) The feature map is Orun QA's; agents read it through Orun QA's MCP, linked into the Orunbase workspace. (8) **Orun QA runs on itself**: from QA1 on, every milestone registers its own features in Orun QA's own hub, verified by its own scenarios on its own stage; a milestone is not done until its own feature reads "Verified" there. |
| Gate | QA1 is the first user-visible change (the hub with the map, no recordings yet). QA2 is when "verified" starts to mean something. QA4 gates production. |
| Shipped as | |

## Read order

1. `design.md` — the resource, the routes, the surfaces, what is out of scope
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| QA0 — the spec | this doc set | merged and pushed with `orun spec push` |
| QA1 — the feature map | features, areas, dependency edges; the hub home, feature page and Insights map | a workspace member sees every feature and the dependency map |
| QA2 — scenarios that run and record | the scenario model, the stage browser runner, recordings, All tests, Try a scenario | a stage run's recording plays on the feature card |
| QA3 — bugs, trackers and developer verification | failure triage, Linear out and back, a Jira provider, the Bugs page, PR impact note and branch verify | a stage failure becomes an assigned issue and closes itself when fixed |
| QA4 — planning and the release sign-off | the scenario planner, the QA desk, the release review and production gate | production waits until the PM approves every change |
| QA5 — the agent, MCP and the public page | the chat, the MCP QA tools, the public feature tour | a coding agent calls the impact tool before it edits |
