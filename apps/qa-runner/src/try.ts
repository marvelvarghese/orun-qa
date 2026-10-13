// Try a scenario: Claude works through a person's plain question on stage in a
// real browser, like a customer would, and answers it. Every action it takes
// is one of the scenario step types, so the steps it took can be saved as a
// scenario exactly as they ran.

import Anthropic from "@anthropic-ai/sdk";
import type { Browser } from "playwright";
import type { ApiCall, PostTryResultRequest, PublicFeature, PublicTry, StepAction, StepTiming, TryAnswer } from "@saas/contracts/qa";
import { RUN_LIMITS, TRY_LIMITS } from "@saas/contracts/qa";
import { boundedCalls, openRecordedPage, packRecording, perform, plainReason, type ConsoleSession } from "./browser.js";
import { type PathVars } from "./plan.js";

export const TRY_MODEL = process.env.QA_TRY_MODEL || "claude-opus-5-5";
/** Enough to answer most questions; a try that needs more says it could not finish. */
const MAX_TURNS = 30;
const MAX_MS = 4 * 60 * 1000;
const PAGE_TEXT_MAX = 12_000;

type Tool = Anthropic.Beta.BetaTool;

const step = { type: "string", description: "This step in plain words, as a customer would describe it, e.g. \"Open Billing history\"." } as const;

/** The tools Claude drives the browser with — one per step type, plus reading the page and finishing. */
export const TRY_TOOLS: Tool[] = [
  {
    name: "open_page",
    description: "Open a page of the product by its path (it must start with /). Use the paths given in the brief.",
    strict: true,
    input_schema: { type: "object", properties: { path: { type: "string" }, step }, required: ["path", "step"], additionalProperties: false },
  },
  {
    name: "click",
    description: "Click something on the page by its visible text. Give its role when it is a button, link, tab, checkbox or menu item; otherwise \"any\".",
    strict: true,
    input_schema: {
      type: "object",
      properties: { text: { type: "string" }, role: { type: "string", enum: ["button", "link", "tab", "checkbox", "menuitem", "any"] }, step },
      required: ["text", "role", "step"],
      additionalProperties: false,
    },
  },
  {
    name: "fill",
    description: "Type into a field, found by its label.",
    strict: true,
    input_schema: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, step }, required: ["label", "value", "step"], additionalProperties: false },
  },
  {
    name: "press_key",
    description: "Press a key, e.g. Enter or Escape.",
    strict: true,
    input_schema: { type: "object", properties: { key: { type: "string" }, step }, required: ["key", "step"], additionalProperties: false },
  },
  {
    name: "read_page",
    description: "Read what is on the page now (its accessibility outline and address). Reading is not a step.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "check_text",
    description: "Check that some text is visible on the page. Returns whether it was found.",
    strict: true,
    input_schema: { type: "object", properties: { text: { type: "string" }, step }, required: ["text", "step"], additionalProperties: false },
  },
  {
    name: "check_api",
    description: "Check that the page called the API: method, path (an API path from the calls listed by read_page or a previous check) and status. Returns whether it was seen.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] }, path: { type: "string" }, status: { type: "integer" }, step },
      required: ["method", "path", "status", "step"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "Give your answer to the question and stop. Call this exactly once, when you know the answer or cannot find out.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        answer: { type: "string", enum: ["yes", "no", "unclear"] },
        headline: { type: "string", description: "The answer in one plain sentence for a product manager, starting with Yes or No when it is one." },
        explanation: { type: "string", description: "Two or three sentences: what you saw that answers it." },
      },
      required: ["answer", "headline", "explanation"],
      additionalProperties: false,
    },
  },
];

export function tryBrief(t: PublicTry, vars: PathVars, features: PublicFeature[]): string {
  const list = features.map((f) => `- ${f.name}: /orgs/${vars.org}/features/${f.id}?hub=${vars.hub}`).join("\n");
  return [
    `You are checking Orun QA's own product on its stage environment, the way a customer would, to answer a product manager's question.`,
    t.asRole === "visitor" ? `You are a visitor who is not signed in.` : `You are signed in as the workspace owner.`,
    ``,
    `The product is a web console. Useful pages (paths, open them with open_page):`,
    `- Features home: /orgs/${vars.org}/features?hub=${vars.hub}`,
    `- Insights (the dependency map): /orgs/${vars.org}/insights?hub=${vars.hub}`,
    `- All tests: /orgs/${vars.org}/tests?hub=${vars.hub}`,
    `- Sign in: /login`,
    `Feature pages:`,
    list,
    ``,
    `How to work:`,
    `- Act through the tools only. Read the page before you click, so you click what is really there.`,
    `- Prefer checks (check_text, check_api) over judging from memory; each passed check becomes evidence.`,
    `- Stay on this product. Do not delete or archive anything unless the question is about exactly that.`,
    `- Be quick: a few steps is usually enough. When you know the answer, call finish.`,
    `- If you cannot find out, call finish with answer "unclear" and say what stopped you.`,
  ].join("\n");
}

/** A concrete step path back to placeholders, so a saved scenario keeps working as ids and slugs change. */
export function templated(path: string, vars: PathVars, features: PublicFeature[]): string {
  let p = path;
  for (const f of features) p = p.split(f.id).join(`{feature:${f.name}}`);
  if (vars.orgId) p = p.split(vars.orgId).join("{orgId}");
  if (vars.org) p = p.split(vars.org).join("{org}");
  if (vars.hub) p = p.split(vars.hub).join("{hub}");
  return p;
}

/** A tool call as the scenario step it is, or null when it is not a step (reading, finishing). */
export function toAction(name: string, input: Record<string, unknown>): StepAction | null {
  const s = (k: string) => String(input[k] ?? "");
  switch (name) {
    case "open_page":
      return { type: "goto", path: s("path") };
    case "click":
      return s("role") === "any" ? { type: "click", text: s("text") } : { type: "click", text: s("text"), role: s("role") };
    case "fill":
      return { type: "fill", label: s("label"), value: s("value") };
    case "press_key":
      return { type: "press", key: s("key") };
    case "check_text":
      return { type: "expect_text", text: s("text") };
    case "check_api":
      return { type: "expect_response", method: s("method"), path: s("path"), status: Number(input.status) };
    default:
      return null;
  }
}

/** Validate a tool input against the shape the tools promise, before running it. */
function validInput(name: string, input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const o = input as Record<string, unknown>;
  const str = (k: string) => typeof o[k] === "string";
  switch (name) {
    case "open_page":
      return str("path") && str("step") && (o.path as string).startsWith("/") && !(o.path as string).startsWith("//");
    case "click":
      return str("text") && str("role") && str("step");
    case "fill":
      return str("label") && str("value") && str("step");
    case "press_key":
      return str("key") && str("step");
    case "check_text":
      return str("text") && str("step");
    case "check_api":
      return str("method") && str("path") && Number.isInteger(o.status) && str("step") && (o.path as string).startsWith("/");
    case "read_page":
      return true;
    case "finish":
      return ["yes", "no", "unclear"].includes(String(o.answer)) && str("headline") && str("explanation");
    default:
      return false;
  }
}

export interface TryOutcome {
  result: PostTryResultRequest | { error: string };
}

export async function runTry(browser: Browser, anthropic: Anthropic, t: PublicTry, vars: PathVars, features: PublicFeature[], session: ConsoleSession, log: (s: string) => void): Promise<TryOutcome> {
  const t0 = Date.now();
  const steps: { text: string; action: StepAction }[] = [];
  const timings: StepTiming[] = [];
  let answer: { answer: TryAnswer; headline: string; explanation: string } | null = null;
  let failure = "";
  const opened = await openRecordedPage(browser, session, { signedIn: t.asRole !== "visitor", record: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `${tryBrief(t, vars, features)}\n\nThe question:\n${t.question}` }];

  try {
    let nudged = 0;
    for (let turn = 0; turn < MAX_TURNS && !answer; turn++) {
      if (Date.now() - t0 > MAX_MS) {
        failure = "It took longer than four minutes without an answer.";
        break;
      }
      const res = await anthropic.beta.messages.create({
        model: TRY_MODEL,
        max_tokens: 16000,
        // If the model declines, the API re-runs the request on a fallback model by refusal category.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        tools: TRY_TOOLS,
        messages,
      });
      if (res.stop_reason === "refusal") {
        failure = "The AI declined to try this question.";
        break;
      }
      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) {
        if (res.stop_reason === "max_tokens" || nudged >= 2) {
          failure = "The AI stopped without giving an answer.";
          break;
        }
        nudged++;
        messages.push({ role: "user", content: "Carry on with the tools, and call finish with your answer." });
        continue;
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        if (!validInput(use.name, use.input)) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "That input does not match the tool's parameters. Check them and try again." });
          continue;
        }
        const input = use.input;
        if (use.name === "finish") {
          answer = { answer: input.answer as TryAnswer, headline: String(input.headline), explanation: String(input.explanation) };
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Recorded." });
          continue;
        }
        if (use.name === "read_page") {
          const outline = await opened.page.locator("body").ariaSnapshot({ timeout: 10_000 }).catch(() => "(the page could not be read)");
          const recent = opened.calls.slice(-12).map((c) => `${c.method} ${c.path} → ${c.status}`).join("\n") || "none yet";
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Address: ${new URL(opened.page.url()).pathname}${new URL(opened.page.url()).search}\n\nRecent API calls:\n${recent}\n\nPage outline:\n${outline.slice(0, PAGE_TEXT_MAX)}`,
          });
          continue;
        }
        const action = toAction(use.name, input)!;
        const start = Date.now() - t0;
        try {
          await perform(opened.page, action, vars, session, opened.calls);
          // Only what worked becomes a step: a saved scenario replays what passed.
          timings.push({ ord: steps.length, startMs: start, endMs: Date.now() - t0, ok: true });
          const saved: StepAction = action.type === "goto" || action.type === "expect_response" ? { ...action, path: templated(action.path, vars, features) } : action;
          steps.push({ text: String(input.step).slice(0, RUN_LIMITS.stepTextMax) || use.name, action: saved });
          results.push({ type: "tool_result", tool_use_id: use.id, content: action.type.startsWith("expect") ? "Found." : "Done." });
        } catch (err) {
          const why = plainReason(err);
          results.push({ type: "tool_result", tool_use_id: use.id, content: action.type.startsWith("expect") ? `Not found. ${why}` : `That did not work. ${why}` });
        }
        if (steps.length >= RUN_LIMITS.stepsMax) break;
      }
      // Every tool_use gets its result, in one user message.
      const answered = new Set(results.map((r) => r.tool_use_id));
      for (const use of uses) if (!answered.has(use.id)) results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Skipped: the step limit was reached. Call finish." });
      messages.push({ role: "user", content: results });
      if (!answer && turn === MAX_TURNS - 1) failure = "It needed more steps than a try allows.";
    }
  } catch (err) {
    failure =
      err instanceof Anthropic.RateLimitError
        ? "The AI is busy right now. Try again in a minute."
        : err instanceof Anthropic.AuthenticationError
          ? "The runner's AI key is not valid."
          : err instanceof Anthropic.APIError
            ? `The AI could not be reached (${err.status ?? "network"}).`
            : `The runner could not finish this try: ${err instanceof Error ? err.message : String(err)}`;
  }
  const events = await opened.close();
  log(`try ${t.id}: ${answer ? `${answer.answer} — ${answer.headline}` : failure || "no answer"} (${steps.length} steps)`);

  if (!answer || steps.length === 0) {
    return { result: { error: (failure || (answer ? "The AI answered without trying anything in the product." : "No answer.")).slice(0, RUN_LIMITS.messageMax) } };
  }
  const durationMs = Date.now() - t0;
  const packed = packRecording(events, t0, timings, durationMs);
  const calls: ApiCall[] = boundedCalls(opened.calls);
  return {
    result: {
      answer: answer.answer,
      headline: answer.headline.slice(0, TRY_LIMITS.headlineMax),
      explanation: `${answer.explanation}${packed.note}`.slice(0, TRY_LIMITS.explanationMax),
      steps,
      stepTimings: timings.map((x) => ({ ...x, startMs: Math.min(x.startMs, RUN_LIMITS.durationMax), endMs: Math.min(x.endMs, RUN_LIMITS.durationMax) })),
      apiCalls: calls,
      ...(packed.recording ? { recording: { encoding: "rrweb+gzip+base64" as const, events: packed.recording } } : {}),
    },
  };
}
