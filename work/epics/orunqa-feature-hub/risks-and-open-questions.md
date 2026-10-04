# orunqa-feature-hub — risks and open questions

Each entry is a letter, a title, and a state: **RISK** (open, with a mitigation), **RESOLVED** (decided; say what and why), **ACCEPTED** (a cost we carry knowingly), **SETTLED** (decided for now; revisit on a stated cadence).

## QA-A — The tester cannot report itself down (RISK, mitigated)

Orun QA tests itself, so a broken runner could leave every feature showing its last good result. Mitigation: the heartbeat job outside the runner (design §6), and "last verified" older than two schedule periods downgrades verified to needs attention everywhere.

## QA-B — Browser minutes cost money (RISK, mitigated)

Browser Rendering is billed by time. Mitigation: no browser on pull requests; stage only, on a schedule; a daily minute cap that stops the run and says so; developer verification runs only the affected scenarios.

## QA-C — Recordings can capture customer data (RISK, mitigated)

Stage may hold realistic data. Mitigation: scenarios run as seeded test accounts; steps can mark fields masked; the public tour shows only recordings flagged public by an admin.

## QA-D — Flaky scenarios erode trust (RISK, mitigated)

Mitigation: retry once, then quarantine; quarantined scenarios run but never block; the agent proposes a hardened version for QA.

## QA-E — whoami and the doctor probe a session-only route (RISK)

`/v1/auth/profile` accepts only browser session tokens, so `whoami` and `orun mcp doctor` fail for CLI and MCP credentials that every other tool accepts. The QA tool set must authenticate through `resolveActor`. The existing whoami and doctor probe should move off the profile route; that fix lives outside this epic.

## QA-F — Where the browser runs (RESOLVED)

Options: Cloudflare Browser Rendering, the customer's CI, or a hosted runner fleet. Decision: Browser Rendering, because the platform is Cloudflare-only and it keeps runs, recordings and the cap in one place. A customer-CI runner can come later behind the same run API.

## QA-G — Orunbase's whoami cannot vouch for a connection (RISK, mitigated)

Connecting a workspace needs to confirm who authorised it. Orunbase's profile route rejects OAuth and CLI tokens (QA-E). Mitigation: confirm the grant by listing the caller's workspaces, which accepts every credential type.

## QA-I — Paid plans are required to grow (ACCEPTED)

Browser Rendering and Email Service need the Cloudflare Workers Paid plan. Supabase's free plan allows two active projects per person (stage and prod use both), and Orunbase's free plan caps a workspace at five brokered secrets, which lumen uses exactly.

## QA-J — Moved from cirrus to lumen (RESOLVED)

Orun QA was first bootstrapped on cirrus (Cloudflare D1). It moved to lumen (Supabase Postgres) before QA1's console shipped, for real transactions and heavier relational queries. QA-2 was ported with its migration rewritten for Postgres; the cirrus repository `orunqa` is retired.

## QA-H — A hub connects to one Orunbase workspace (ACCEPTED)

Some companies split a product across workspaces. One connection per hub keeps the catalog, runs and approvals unambiguous for the first release; an organization can hold many hubs.

## QA-K — Independent first, Orunbase later (SETTLED)

Orun QA ships as a standalone product with its own workspaces; its own workspace is the default and tests Orun QA itself. The Orunbase integration (sign-in, catalog seed, deploy trigger, production gate) is QA6. Revisit when QA5 ships.
