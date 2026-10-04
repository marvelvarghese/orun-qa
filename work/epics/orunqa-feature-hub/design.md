# orunqa-feature-hub — design

The surfaces below are drawn on the **Orun QA** design canvas (Feature hub · PM view page). Each console section names its artboard. Everything is described for the PM first: technical detail exists, but behind a toggle.

## 0. Shape and placement

Orun QA is a separate product: its own repository (`orun-qa`) bootstrapped from the **lumen** baseline, its own Orunbase workspace ("Orun QA"), its own domain. lumen already ships identity, membership, projects, policy, audit, metering, billing, events, webhooks, notifications and integrations as Workers behind one edge API, with a Next.js console, on Supabase Postgres reached through Cloudflare Hyperdrive. Orun QA adds:

```
apps/qa-worker          hubs, areas, features, edges, scenarios, runs, results, bugs, plans, reviews; scheduler; triage
apps/runner-worker      Playwright on Cloudflare Browser Rendering against a hub's stage URL; recordings to R2
apps/mcp-worker         the QA tool set over MCP (streamable HTTP, OAuth)
apps/integrations-worker  + providers: orunbase, linear, jira (github and slack as lumen ships them, or added)
apps/web-console-next   the hub surfaces (§3); the public tour under /p/{slug}
packages/contracts      + qa wire types;  packages/db + the qa schema (Postgres, one schema per bounded context like the rest)
tests/scenarios/        Orun QA's own scenarios (§6)
```

Each new Worker follows the baseline's bounded-context rules: its own schema (`qa`, `runner`), routes behind `api-edge`, `component.yaml` so `orun plan` deploys it to stage and prod.

**Tenancy.** A customer signs up to Orun QA and gets an Orun QA organization (lumen membership). Each hub in it connects to exactly one of the customer's Orunbase workspaces through the Orunbase provider (§4). People and roles are Orun QA's own; signing in with Orunbase links the identities so a workspace's members can be invited in one step.

## 1. The resource

All rows carry `org_id` (the Orun QA organization, lumen membership). A hub also stores `orunbase_workspace` (the connected `ws_…`). Ids are prefixed.

```
hub            hub_…   one per workspace: name, stage URL, prod URL, public slug, schedule, daily minute cap
area           area_…  a product area: name, order
feature        feat_…  name, plain description, area_id, owner_user_id, qa_user_id, health (derived), public (bool),
                        spec_links[] (tracker refs), code_refs[] (paths, routes, components)
feature_edge   edge_…  from_feature_id → to_feature_id ("to needs from"), source (agent|human), confirmed_by, confirmed_at
scenario       scn_…   feature_id, name, expected (plain text), kind (screens_apis | api_only), cadence (daily|release|once),
                        tested_by (ai|manual|extension), state (draft|in_review|approved|quarantined), as_role
step           stp_…   scenario_id, ord, kind (screen|api|event), plain text, technical (selector/route/event name)
run            run_…   hub_id, trigger (schedule|deploy|branch|try|tracker_fixed), ref (branch, sha), env, started/finished, minutes
result         res_…   run_id, scenario_id, verdict (works|fails|slow|skipped|flaky), failing_step_id, recording_id
api_check      apc_…   result_id, step_id, method, path, status, expected_status, ms
recording      rec_…   result_id, r2 key, duration, poster frame, masked (bool)
bug            bug_…   feature_id, scenario_id?, title, what_happened, what_should, severity, source (ai|manual|customer|extension),
                        tracker (linear|jira), tracker_key, assignee, state
review         rvw_…   hub_id, release name, tracker release ref (cycle / fix version), state (waiting|blocked|approved|shipped)
review_change  chg_…   review_id, feature_id, kind (new|looks_different|works_differently|behind_the_scenes),
                        before_recording_id, after_recording_id, step_diff, api_diff, decision (pending|approved|changes), decided_by
plan           pln_…   hub_id, source (typed|linear|jira), tracker ref, criteria[], open_questions[], state
```

`health` is derived on read from the latest results of a feature's approved scenarios: verified, needs attention, broken, not tested. It is never stored.

## 2. The API

Envelopes follow the platform's `{ data, meta }`. Every route is scoped to `/v1/hubs/{hub}` behind `api-edge` and authorized by the caller's role in the Orun QA organization (policy-worker).

```
GET    /v1/hubs/{hub}/features                  ?area &health
GET    /v1/hubs/{hub}/features/{feat}           feature + scenarios + bugs + edges + latest recording
POST   /v1/hubs/{hub}/features                  admin
PATCH  /v1/hubs/{hub}/features/{feat}           admin
GET    /v1/hubs/{hub}/map                       nodes + edges, for Insights
POST   /v1/hubs/{hub}/map/scan                  agent drafts features and edges from the repo; drafts need confirming
GET    /v1/hubs/{hub}/scenarios                 ?feature &kind &verdict   (All tests)
POST   /v1/hubs/{hub}/scenarios                 qa | admin; lands as draft
POST   /v1/hubs/{hub}/scenarios/{scn}/approve   admin
POST   /v1/hubs/{hub}/runs                      { trigger, scenarios?, ref? }   branch verify, try, manual
GET    /v1/hubs/{hub}/runs/{run}                results, api checks, recordings
POST   /v1/hubs/{hub}/try                       { question, as_role, env }   one-off, unsaved until /save
GET    /v1/hubs/{hub}/bugs
POST   /v1/hubs/{hub}/bugs                      manual report
POST   /v1/hubs/{hub}/plans                     { source, text | tracker_ref } → criteria, drafts, questions
POST   /v1/hubs/{hub}/plans/{pln}/send          drafts → QA review; optional tracker sub-issues
GET    /v1/hubs/{hub}/reviews/{rvw}
POST   /v1/hubs/{hub}/reviews/{rvw}/changes/{chg}/decide   { decision }   admin
POST   /v1/hubs/{hub}/reviews/{rvw}/approve     admin; only when every change is approved
GET    /v1/public/{slug}/features               anonymous: public features, last verified recording
```

## 3. The console

The web app has a left rail (product: Features, Reviews, Bugs, Insights; testing: Plan scenarios, All tests, Try a scenario, Scenario desk; then the public page, settings and the user). Canvas artboards in brackets.

- **Features home** [Feature catalog · home] — health bar, "needs you today", filters, cards with looping recordings grouped by area. A list and a table view are a toggle away.
- **Feature page** [Feature · recorded demo, scenarios, ripple] — the player with chapters and a failed-vs-last-verified switch, plain failure text, scenarios with who tested them, "when this breaks, these are affected", people and tracker links, the public switch.
- **Release review** [Release review] — the five-step strip, one card per change with before/after recordings or step diffs, approve or request changes each, production approval unlocking only when all are approved.
- **All tests** [All tests] — every scenario, expandable to steps and the API calls checked; add a scenario for AI.
- **Try a scenario** [Try a scenario] — a plain question, run once as a chosen role, answer with recording, save or report.
- **Ask the agent** [Ask the agent] — chat over features, tests and bugs; can try a scenario and draft scenarios.
- **Insights** [Insights] — the clickable dependency map, what a feature relies on and what breaks with it, problem areas, thin coverage.
- **Scenario desk** [Scenario desk] — QA's queue, the scenario composer, AI or manual testing, the report form.
- **Bugs** [Bugs] — full report with recording, steps, environment, also-affects, history, tracker state.
- **Plan scenarios** [Plan scenarios] — type it, or pull from Linear or Jira; criteria become scenarios; edge cases; re-checks; questions the AI could not answer.
- **Pipeline & integrations** [Settings] — the pipeline strip, stage schedule and cap, failure rules, trackers, MCP access.
- **Public feature tour** [Public feature tour] — anonymous, verified recordings only.

## 4. Pipeline, events and integrations

- **Pull request.** API-only scenarios for touched features, plus an impact note comment listing affected features and the browser scenarios to verify. No browser.
- **Developer verification.** `POST /runs { trigger: branch }` for the affected browser scenarios, from the CLI or a PR comment. Required before review when the hub says so.
- **Stage.** The full browser run on the hub's schedule (off, nightly, after each stage deploy, or both), stopped at the daily minute cap. This run refreshes recordings.
- **Failure triage.** Retry once, then flaky and quarantine; if the plan or spec says the behaviour changed, a `works_differently` review change; otherwise a bug, assigned to the author of the last change touching the feature's `code_refs`. Repeats update one living comment. The next green run closes it.
- **Production.** The connected workspace's prod promotion already pauses on `requireApproval`. Orun QA's release review resolves that approval through Orunbase's approvals API when the PM approves, and leaves it waiting otherwise.
- **Orunbase (the deepest integration).** Sign in with Orunbase (OAuth, in identity-worker). A hub connects to one Orunbase workspace through the `orunbase` provider: it reads the service catalog to seed features and `code_refs`, reads repos and runs, subscribes to run webhooks so a finished stage deploy triggers the stage run, resolves the production approval (above), and links bugs and plans to Orunbase epics and tasks. Orun QA publishes an `orunqa` skill to the workspace's skill registry and its MCP endpoint is listed in the workspace's MCP settings.
- **Trackers.** Linear and Jira as providers in `integrations-worker`, with the same rules as Orunbase's own tracker write-back: forward-only status, one living comment, never undo a human edit. Specs in, bugs out, "fixed" back triggers a re-run, review approval posts to linked issues.
- **Events.** `qa.run.finished`, `qa.feature.health_changed`, `qa.bug.opened`, `qa.review.decided`, `qa.review.approved`, for Slack and webhooks.
- **MCP.** A QA tool set in `mcp-worker`: impact of a change, look up a feature, find scenarios, propose scenarios (QA reviews), verify on a branch (needs approval). Its own endpoint, OAuth like Orunbase's MCP; the credential check goes through the edge's actor resolution, which accepts sessions, API keys and OAuth tokens alike, never a session-only route (QA-E).

## 5. Out of scope

Native mobile apps; load and performance testing; a hosted Playwright IDE; the Chrome capture extension (designed, deferred to a later epic); usage analytics overlays (a later epic, once a provider is chosen); hubs spanning more than one Orunbase workspace; changes to Orunbase itself beyond its public API.

## 6. Orun QA tests itself

Orun QA is its own first customer. A hub inside Orun QA, connected to Orun QA's own Orunbase workspace, lists Orun QA's own features (Features home, Feature page, Release review, All tests, Try, Agent, Insights, Desk, Bugs, Planner, Settings, Public tour, the runner, the MCP tools), with their dependency edges.

- Its scenarios live in `tests/scenarios/` and run on Orun QA's own stage, scheduled by Orun QA's own hub.
- A failure in its own stage run files a bug against Orun QA through its own triage.
- Its own production promotion waits on its own release review.
- Its own public tour shows Orun QA recorded by itself.
- **The heartbeat.** Self-testing cannot report that the tester is down. A small GitHub Actions job, outside the runner, checks every hour that the last Orun QA stage run finished within its window. If not, it alerts Slack and marks the hub's own health "unknown" through a seam. "Last verified" older than two schedule periods turns a feature from verified to needs attention everywhere.
