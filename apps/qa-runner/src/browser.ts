// Run one scenario in a real browser: sign the console in, record the DOM with
// rrweb, perform each step, and note every call the page made to the API.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Browser, Locator, Page } from "playwright";
import type { ApiCall, PublicScenario, StepAction, StepTiming, Verdict } from "@saas/contracts/qa";
import { RUN_LIMITS } from "@saas/contracts/qa";
import { describe, fillPath, findCall, pathOf, type PathVars } from "./plan.js";

const require = createRequire(import.meta.url);
// The browser build sits beside the package entry (it is not in the package's exports map).
const RRWEB_RECORD = readFileSync(join(dirname(require.resolve("@rrweb/record")), "record.umd.min.cjs"), "utf8");

/** Starts rrweb in every document the page loads and streams events out. */
const START_RECORDING = `(() => {
  if (window.top !== window || window.__qaRecording) return;
  window.__qaRecording = true;
  const go = () => window.rrwebRecord.record({
    emit: (e) => window.__qaEmit(JSON.stringify(e)),
    maskAllInputs: false,
    maskInputOptions: { password: true },
    sampling: { mousemove: 50, scroll: 150 },
    recordCanvas: false,
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
  else go();
})();`;

export interface ConsoleSession {
  consoleUrl: string;
  apiUrl: string;
  token: string;
  storagePrefix: string;
}

export interface ScenarioOutcome {
  verdict: Verdict;
  failingStep: number | null;
  message: string;
  durationMs: number;
  stepTimings: StepTiming[];
  apiCalls: ApiCall[];
  /** gzip + base64 rrweb events, or null when there is nothing to show. */
  recording: string | null;
}

const STEP_TIMEOUT = 15_000;

function locate(page: Page, a: { text?: string; testId?: string; role?: string; label?: string }): Locator {
  if (a.testId) return page.getByTestId(a.testId).first();
  if (a.label) return page.getByLabel(a.label).first();
  if (a.role) return page.getByRole(a.role as Parameters<Page["getByRole"]>[0], { name: a.text ?? "" }).first();
  return page.getByText(a.text ?? "", { exact: true }).first();
}

async function perform(page: Page, action: StepAction, vars: PathVars, session: ConsoleSession, calls: ApiCall[]): Promise<void> {
  switch (action.type) {
    case "goto":
      await page.goto(new URL(fillPath(action.path, vars), session.consoleUrl).toString(), { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      return;
    case "click":
      await locate(page, action).click({ timeout: STEP_TIMEOUT });
      return;
    case "fill":
      await locate(page, action).fill(action.value, { timeout: STEP_TIMEOUT });
      return;
    case "press":
      await page.keyboard.press(action.key);
      return;
    case "expect_text":
      await page.getByText(action.text).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT });
      return;
    case "expect_visible":
      await locate(page, action).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
      return;
    case "expect_url": {
      const want = fillPath(action.path, vars).split("?")[0]!;
      await page.waitForURL((u) => u.pathname === want, { timeout: STEP_TIMEOUT });
      return;
    }
    case "expect_response": {
      const deadline = Date.now() + STEP_TIMEOUT;
      while (!findCall(calls, action, vars)) {
        if (Date.now() > deadline) {
          const seen = calls.map((c) => `${c.method} ${c.path} → ${c.status}`).slice(-5).join("; ") || "none";
          throw new Error(`no ${action.method} ${fillPath(action.path, vars)} answering ${action.status} (recent calls: ${seen})`);
        }
        await page.waitForTimeout(200);
      }
      return;
    }
  }
}

export async function runScenario(browser: Browser, scenario: PublicScenario, vars: PathVars, session: ConsoleSession): Promise<ScenarioOutcome> {
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const events: string[] = [];
  const calls: ApiCall[] = [];
  const timings: StepTiming[] = [];
  const t0 = Date.now();
  let verdict: Verdict = "works";
  let failingStep: number | null = null;
  let message = "";

  try {
    // The console keeps its session in localStorage: hand it the runner's token.
    await context.addInitScript(
      ({ prefix, token }) => {
        try {
          window.localStorage.setItem(`${prefix}.token`, token);
          window.localStorage.setItem(`${prefix}.target`, "stage");
        } catch {
          /* storage unavailable: the scenario will fail at its first check */
        }
      },
      { prefix: session.storagePrefix, token: session.token },
    );
    const record = scenario.kind === "screens_apis";
    if (record) {
      await context.exposeBinding("__qaEmit", (_src, e: string) => {
        events.push(e);
      });
      // Run the UMD build with `this` bound to window so it defines window.rrwebRecord.
      await context.addInitScript({ content: `(function () {\n${RRWEB_RECORD}\n}).call(window);\n${START_RECORDING}` });
    }

    const page = await context.newPage();
    page.on("pageerror", (e) => {
      if (/rrweb|__qaEmit/.test(String(e))) message = `${message} (recorder: ${String(e).slice(0, 200)})`.trim();
    });
    const apiOrigin = new URL(session.apiUrl).origin;
    page.on("requestfinished", (req) => {
      void (async () => {
        if (new URL(req.url()).origin !== apiOrigin || req.method() === "OPTIONS") return;
        const res = await req.response();
        const t = req.timing();
        calls.push({ method: req.method(), path: pathOf(req.url()), status: res?.status() ?? 0, ms: Math.max(0, Math.round(t.responseEnd)) });
      })();
    });
    page.on("requestfailed", (req) => {
      if (new URL(req.url()).origin === apiOrigin && req.method() !== "OPTIONS") calls.push({ method: req.method(), path: pathOf(req.url()), status: 0, ms: 0 });
    });

    for (const step of scenario.steps) {
      const start = Date.now() - t0;
      try {
        await perform(page, step.action, vars, session, calls);
        timings.push({ ord: step.ord, startMs: start, endMs: Date.now() - t0, ok: true });
      } catch (err) {
        timings.push({ ord: step.ord, startMs: start, endMs: Date.now() - t0, ok: false });
        verdict = "fails";
        failingStep = step.ord;
        const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
        message = `Step ${step.ord + 1} — “${step.text}”: could not ${describe(step.action)}. ${why}`.slice(0, RUN_LIMITS.messageMax);
        break;
      }
    }
    // Let the last frames reach the recording.
    await page.waitForTimeout(600);
  } catch (err) {
    verdict = "errored";
    message = `The runner could not run this scenario: ${err instanceof Error ? err.message : String(err)}`.slice(0, RUN_LIMITS.messageMax);
  } finally {
    await context.close().catch(() => undefined);
  }

  let recording: string | null = null;
  if (events.length > 0) {
    const packed = gzipSync(Buffer.from(`[${events.join(",")}]`)).toString("base64");
    if (packed.length <= RUN_LIMITS.recordingMax) recording = packed;
    else message = `${message} (recording dropped: ${Math.round(packed.length / 1e6)} MB is over the limit)`.trim();
  }

  return {
    verdict,
    failingStep,
    message,
    durationMs: Math.min(Date.now() - t0, RUN_LIMITS.durationMax),
    stepTimings: timings.map((t) => ({ ...t, endMs: Math.min(t.endMs, RUN_LIMITS.durationMax), startMs: Math.min(t.startMs, RUN_LIMITS.durationMax) })),
    apiCalls: calls.slice(0, RUN_LIMITS.apiCallsMax).map((c) => ({ ...c, method: c.method.slice(0, 10), path: c.path.slice(0, 300), ms: Math.min(c.ms, RUN_LIMITS.durationMax) })),
    recording,
  };
}
