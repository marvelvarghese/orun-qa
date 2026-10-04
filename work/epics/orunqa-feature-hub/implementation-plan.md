# orunqa-feature-hub — implementation plan

Milestones land in order. Each is one or more tasks, each task one pull request, each pull request landed with `orun pr land`. A milestone is marked ✅ here when its "done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md`.

**The self-test rule.** From QA1 on, a milestone is not done until the features it ships are registered in Orun QA's own hub and read "Verified" there from Orun QA's own stage run (QA1, before the runner exists, registers them as "Not tested yet").

## QA0 — the spec

This doc set, merged to `main` and attached to the epic with `orun spec push`.

**Done when**
- the five documents and `epic.yaml` are on `main`
- `orun spec list --epic orunqa-feature-hub` shows them

## QA1 — the feature map

On the bootstrapped lumen repository: `apps/qa-worker` with `component.yaml`, the `qa` schema migration for hub, area, feature and feature_edge, routes behind `api-edge`, contracts and sdk types. The `orunbase` provider in `integrations-worker` (connect a workspace, read its catalog) and Sign in with Orunbase. The Features home, the Feature page (no recordings yet) and the Insights dependency map. The agent scan drafts features and edges from the repo for a person to confirm.

**Done when**
- `qa-worker` answers `/health` on stage and prod, and its migrations applied on both
- a user signs in with Orunbase, connects an Orunbase workspace, and the hub seeds features from its catalog
- a non-member of the Orun QA organization gets 404 on its hubs
- the Features home, Feature page and Insights map render from real rows
- Orun QA's own hub lists the QA1 features with their edges, as "Not tested yet"

## QA2 — scenarios that run and record

The scenario, step, run, result, api_check and recording tables. `apps/runner-worker` drives Playwright on Cloudflare Browser Rendering against the hub's stage URL, records the run, masks marked fields, stores to R2. The stage schedule and daily minute cap, and the Orunbase run webhook that starts a stage run after each deploy. All tests, Try a scenario, the looping recordings on cards and the feature player.

**Done when**
- a scheduled stage run executes every approved scenario and writes results with recordings
- the run stops at the daily cap and says so in Settings
- All tests expands a scenario to its steps and API checks
- Try a scenario returns an answer with a recording in under two minutes
- every QA1 and QA2 feature reads "Verified" in Orun QA's own hub, from its own stage run

## QA3 — bugs, trackers and developer verification

Triage (retry, quarantine, intended change, bug). The Bugs page. Linear bugs out and "fixed" back through the existing provider and write-back. A Jira provider in `integrations-worker`. The PR impact note and branch verification from the CLI or a PR comment. The heartbeat job.

**Done when**
- a failing stage scenario opens one Linear or Jira issue with recording and steps, assigned to the last author
- a second failure updates that issue's one comment instead of opening another
- moving the issue to done in the tracker re-runs its scenarios; green closes the bug
- a PR touching a feature gets an impact note; `branch` verification runs the affected scenarios
- a failure in Orun QA's own stage run files a bug against Orun QA
- stopping the runner trips the heartbeat alert within an hour

## QA4 — planning and the release sign-off

The scenario planner (typed, Linear, Jira), with criteria, drafts, edge cases, re-checks and open questions. The Scenario desk with QA review and approval. The release review: changes derived from the release's merged PRs and the stage run's before/after recordings and step diffs. Resolving the connected workspace's production approval through Orunbase when the PM approves.

**Done when**
- a Linear or Jira issue becomes a plan whose drafts reach QA for review
- a release review lists every changed feature with its evidence
- prod promotion stays waiting until every change is approved; requesting changes blocks it and notifies the tracker
- Orun QA's own release to production went through its own review

## QA5 — the agent, MCP and the public page

Ask the agent, grounded on the hub's features, scenarios and bugs. `apps/mcp-worker` with the QA tool set, listed in the connected Orunbase workspace's MCP settings, and the `orunqa` skill published to its registry. The public feature tour with verified recordings only.

**Done when**
- the chat answers "what breaks if X fails" from the map, and cites its sources
- a coding agent calls the impact tool over MCP and gets the affected features and scenarios
- verify over MCP requires a person's approval before it runs
- an anonymous visitor browses the public tour; a broken feature shows its last verified recording
- Orun QA's own public tour shows Orun QA, recorded by itself

## Sequencing note

Before QA1, the factory's own steps run: the Orun QA workspace is created, Cloudflare connected, and the lumen baseline bootstrapped live on stage and prod; QA0 is that repository's first pull request. QA1 must come first among milestones: everything hangs off features and the Orunbase connection. QA2 needs QA1's features to attach scenarios to. QA3 needs QA2's failures to triage; the Jira provider can be built in parallel with QA2. QA4 needs QA2's recordings for before/after and QA3's tracker links. QA5's chat and MCP need the map and results; the public page only needs QA2. Orun QA's own hub is created in QA1 and grows with every milestone, so self-testing is never a final step.
