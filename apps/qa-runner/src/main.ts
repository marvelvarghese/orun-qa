// Orun QA's headless runner. Signs in to stage, makes sure the self hub and its
// declared scenarios exist, runs every approved scenario in a real browser with
// rrweb recording the DOM, and posts each result and recording to the run.
//
//   QA_API_URL       api-edge base URL           (default: stage)
//   QA_CONSOLE_URL   console base URL            (default: stage)
//   QA_RUNNER_EMAIL  the runner's account        (default: qa-runner@orunqa.app)
//   QA_RUNNER_TOKEN  a bearer token to use instead of signing in
//   QA_TRIGGER       schedule | deploy | manual  (default: manual)
//   QA_REF           the commit under test       (default: GITHUB_SHA)
//   QA_MODE          run | try                   (default: run — runs the scenarios, then answers any queued tries)
//   ANTHROPIC_API_KEY  the AI that answers tries; without it a queued try is answered "not set up"

import { appendFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";
import { OrunQA } from "@saas/sdk";
import { ORUN_QA_SELF } from "@saas/contracts/qa-self";
import type { PublicFeature, PublicResult, PublicRun, PublicScenario, RunTrigger, ScenarioCadence } from "@saas/contracts/qa";
import { runScenario, type ConsoleSession } from "./browser.js";
import { exitCode, sameScenario, type PathVars } from "./plan.js";
import { ORUN_QA_SELF_SCENARIOS } from "./scenarios.js";
import { runTry, TRY_MODEL } from "./try.js";

const API_URL = process.env.QA_API_URL ?? "https://orun-qa-api-edge-stage.rahulvarghesepullely.workers.dev";
const CONSOLE_URL = process.env.QA_CONSOLE_URL ?? "https://orun-qa-web-console-next-stage.rahulvarghesepullely.workers.dev";
const EMAIL = process.env.QA_RUNNER_EMAIL ?? "qa-runner@orunqa.app";
const TRIGGERS: RunTrigger[] = ["schedule", "deploy", "manual"];
const TRIGGER = (TRIGGERS as string[]).includes(process.env.QA_TRIGGER ?? "") ? (process.env.QA_TRIGGER as RunTrigger) : "manual";
/** No API call may hang the job: each gets this long. */
const REQUEST_TIMEOUT_MS = 30_000;
const REF = process.env.QA_REF ?? process.env.GITHUB_SHA ?? null;
const STORAGE_PREFIX = "orun-qa.next";
const SELF_HUB_SLUG = "orun-qa";
const MODE = process.env.QA_MODE === "try" ? "try" : "run";
/** A try job answers at most this many before it ends (the next job takes the rest). */
const TRIES_PER_JOB = 5;

/** Which cadences a trigger runs: a schedule runs the daily set, a deploy adds release checks. */
const CADENCES: Record<RunTrigger, ScenarioCadence[]> = {
  schedule: ["daily"],
  deploy: ["daily", "release"],
  manual: ["daily", "release", "manual"],
  try: ["daily", "release", "manual"],
};

// eslint-disable-next-line no-console -- the runner is a CLI: its log is the job's output
const log = (line: string) => console.log(line);

/**
 * Stage answers login/start with the code inline (DEBUG_DELIVERY), so the runner
 * signs in like a person would, without a mailbox. Prod never does.
 */
async function signIn(): Promise<string> {
  if (process.env.QA_RUNNER_TOKEN) return process.env.QA_RUNNER_TOKEN;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { message?: string } };
    if (!res.ok || !json.data) throw new Error(`${path} answered ${res.status}: ${json.error?.message ?? "no data"}`);
    return json.data;
  };
  const start = await post("/v1/auth/login/start", { email: EMAIL });
  const code = (start.delivery as { code?: string } | undefined)?.code;
  if (!code) throw new Error("Stage did not hand back a sign-in code (DEBUG_DELIVERY is off); set QA_RUNNER_TOKEN instead.");
  const done = await post("/v1/auth/login/complete", { challengeId: start.challengeId, code });
  return done.token as string;
}


async function main(): Promise<number> {
  const token = await signIn();
  const client = new OrunQA({
    baseUrl: API_URL,
    auth: { kind: "bearer", token },
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  });

  // The runner's own workspace is Orun QA's product workspace (its personal org on stage).
  const org = (await client.organizations.list()).organizations[0];
  if (!org) throw new Error("The runner's account has no workspace");
  log(`workspace ${org.slug} (${org.id})`);

  let hub = (await client.qa.listHubs(org.id)).hubs.find((h) => h.slug === SELF_HUB_SLUG);
  if (!hub) hub = (await client.qa.createHub(org.id, { name: "Orun QA", slug: SELF_HUB_SLUG, stageUrl: CONSOLE_URL })).hub;
  const imported = (await client.qa.importManifest(org.id, hub.id, ORUN_QA_SELF)).result;
  log(`hub ${hub.id}: features ${JSON.stringify(imported.features)}`);

  const features = new Map((await client.qa.listFeatures(org.id, hub.id)).features.map((f) => [f.name.toLowerCase(), f.id]));
  const vars: PathVars = { org: org.slug, orgId: org.id, hub: hub.id, features };

  // Write the declared scenarios into the hub. They are reviewed as code, so the
  // runner approves what it writes. What a person decided stands: an archived
  // scenario stays archived, a quarantined or hand-drafted one is left alone.
  const existing = new Map((await client.qa.listScenarios(org.id, hub.id, { archived: true })).scenarios.map((s) => [s.name.toLowerCase(), s]));
  for (const d of ORUN_QA_SELF_SCENARIOS) {
    const featureId = features.get(d.feature.toLowerCase());
    if (!featureId) throw new Error(`Declared scenario "${d.name}" names an unknown feature "${d.feature}"`);
    const s = existing.get(d.name.toLowerCase());
    let written: PublicScenario | null = null;
    if (!s) {
      written = (await client.qa.createScenario(org.id, hub.id, { featureId, name: d.name, expected: d.expected ?? "", steps: d.steps })).scenario;
      log(`scenario added: ${d.name}`);
    } else if (s.state === "approved" && !sameScenario(s, d)) {
      written = (await client.qa.updateScenario(org.id, hub.id, s.id, { steps: d.steps, expected: d.expected ?? "" })).scenario;
      log(`scenario updated: ${d.name}`);
    } else if (s.state !== "approved") {
      log(`scenario left as ${s.state}: ${d.name}`);
    }
    if (written?.state === "draft") await client.qa.approveScenario(org.id, hub.id, written.id, { updatedAt: written.updatedAt });
  }

  const session: ConsoleSession = { consoleUrl: CONSOLE_URL, apiUrl: API_URL, token, storagePrefix: STORAGE_PREFIX };
  const featureList = (await client.qa.listFeatures(org.id, hub.id)).features;
  if (MODE === "try") return answerTries(client, org.id, hub.id, vars, featureList, session);

  const cadences = CADENCES[TRIGGER] ?? CADENCES.manual;
  const toRun = (await client.qa.listScenarios(org.id, hub.id)).scenarios.filter((s) => s.state === "approved" && cadences.includes(s.cadence));
  const hubId = hub.id;
  const run = (await client.qa.createRun(org.id, hubId, { trigger: TRIGGER, env: "stage", ref: REF })).run;
  log(`run ${run.id}: ${toRun.length} scenario(s)`);

  const results: { scenario: PublicScenario; result: PublicResult }[] = [];
  let runnerBroke = false;
  let finished: PublicRun | null = null;
  // However the job ends — an error, a cancel, the timeout — the run is finished, never left running.
  const finish = async (errored: boolean) => {
    if (finished) return finished;
    for (let attempt = 0; attempt < 3 && !finished; attempt++) {
      finished = await client.qa
        .finishRun(org.id, hubId, run.id, { errored })
        .then((r) => r.run)
        .catch((err: unknown) => {
          log(`could not finish the run (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
    }
    return finished;
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      log(`${signal}: finishing the run as errored`);
      void finish(true).finally(() => process.exit(1));
    });
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
    for (const scenario of toRun) {
      const out = await runScenario(browser, scenario, vars, session);
      const { result } = await client.qa.postResult(org.id, hub.id, run.id, {
        scenarioId: scenario.id,
        verdict: out.verdict,
        failingStep: out.failingStep,
        message: out.message,
        durationMs: out.durationMs,
        stepTimings: out.stepTimings,
        apiCalls: out.apiCalls,
        ...(out.recording ? { recording: { encoding: "rrweb+gzip+base64" as const, events: out.recording } } : {}),
      });
      results.push({ scenario, result });
      log(`${out.verdict === "works" ? "✓" : "✕"} ${scenario.name} — ${out.verdict}${out.message ? `: ${out.message}` : ""}`);
    }
  } catch (err) {
    runnerBroke = true;
    log(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser?.close().catch(() => undefined);
    await finish(runnerBroke);
  }
  if (!finished) throw new Error(`run ${run.id} could not be finished`);
  const done: PublicRun = finished;
  log(`run ${run.id} ${done.status}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(({ scenario, result }) => `| ${result.verdict === "works" ? "✓" : "✕"} | ${scenario.name} | ${result.verdict} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.recordingId ? "recorded" : "—"} |`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [`### Orun QA run — ${done.status}`, "", `${TRIGGER} run on stage${REF ? ` at \`${REF.slice(0, 7)}\`` : ""}`, "", "| | Scenario | Verdict | Time | Recording |", "|---|---|---|---|---|", ...rows, ""].join("\n"),
    );
  }
  // Answer any tries still waiting (when no dispatch started them at once). Their outcome never fails the run.
  await answerTries(client, org.id, hubId, vars, featureList, session).catch((err: unknown) => log(`tries: ${err instanceof Error ? err.message : String(err)}`));
  return runnerBroke ? 1 : exitCode(results.map((r) => r.result.verdict));
}

/**
 * Take queued tries one at a time and answer each with the AI. Without an AI
 * key, each is answered plainly that trying is not set up, rather than left
 * waiting. Returns the job's exit code: only a broken runner fails it.
 */
async function answerTries(client: OrunQA, orgId: string, hubId: string, vars: PathVars, features: PublicFeature[], session: ConsoleSession): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let answered = 0;
  try {
    for (let i = 0; i < TRIES_PER_JOB; i++) {
      const claimed = (await client.qa.claimTry(orgId, hubId)).try;
      if (!claimed) break;
      if (!key) {
        await client.qa.postTryResult(orgId, hubId, claimed.id, { error: "Trying is not set up yet: the runner has no AI key (ANTHROPIC_API_KEY)." });
        log(`try ${claimed.id}: no AI key`);
        continue;
      }
      browser ??= await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
      const anthropic = new Anthropic({ apiKey: key });
      try {
        const out = await runTry(browser, anthropic, claimed, vars, features, session, log);
        await client.qa.postTryResult(orgId, hubId, claimed.id, out.result);
        answered++;
      } catch (err) {
        // Never leave a claimed try running: say it could not be answered.
        await client.qa
          .postTryResult(orgId, hubId, claimed.id, { error: `The runner could not finish this try: ${err instanceof Error ? err.message : String(err)}`.slice(0, 4000) })
          .catch(() => undefined);
        log(`try ${claimed.id}: runner error`);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
  if (answered > 0) log(`answered ${answered} tr${answered === 1 ? "y" : "ies"} with ${TRY_MODEL}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`qa-runner: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
