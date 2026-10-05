// The runner's pure parts: placeholders in step paths, matching the API calls a
// page made against a step's expectation, and the run's exit status.

import type { ApiCall, StepAction, Verdict } from "@saas/contracts/qa";

/** What a step path may name: the org slug, the hub id, and a feature id by name. */
export interface PathVars {
  org: string;
  hub: string;
  orgId: string;
  features: ReadonlyMap<string, string>;
}

/**
 * Fill `{org}`, `{orgId}`, `{hub}` and `{feature:Name}` in a step path. An
 * unknown placeholder is an error, so a typo fails the scenario instead of
 * opening the wrong page.
 */
export function fillPath(template: string, vars: PathVars): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (key === "org") return encodeURIComponent(vars.org);
    if (key === "orgId") return encodeURIComponent(vars.orgId);
    if (key === "hub") return encodeURIComponent(vars.hub);
    if (key.startsWith("feature:")) {
      const id = vars.features.get(key.slice("feature:".length).toLowerCase());
      if (!id) throw new Error(`No feature named "${key.slice("feature:".length)}" in the hub`);
      return encodeURIComponent(id);
    }
    throw new Error(`Unknown placeholder {${key}}`);
  });
}

/** The path of an absolute URL, without its query. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

/** Match a path against a pattern where `*` stands for exactly one segment. */
export function matchPath(pattern: string, path: string): boolean {
  const p = pattern.split("?")[0]!.replace(/\/+$/, "").split("/");
  const a = path.replace(/\/+$/, "").split("/");
  return p.length === a.length && p.every((seg, i) => seg === "*" || seg === a[i]);
}

/** Did the page make the call an `expect_response` step names? */
export function findCall(calls: readonly ApiCall[], step: Extract<StepAction, { type: "expect_response" }>, vars: PathVars): ApiCall | undefined {
  const pattern = fillPath(step.path, vars);
  return calls.find((c) => c.method === step.method.toUpperCase() && c.status === step.status && matchPath(pattern, c.path));
}

/** A one-line, human description of what a step looks for — used in failure messages. */
export function describe(action: StepAction): string {
  switch (action.type) {
    case "goto":
      return `open ${action.path}`;
    case "click":
      return `click ${action.testId ? `[${action.testId}]` : `"${action.text}"`}`;
    case "fill":
      return `fill ${action.testId ? `[${action.testId}]` : `"${action.label}"`}`;
    case "press":
      return `press ${action.key}`;
    case "expect_text":
      return `see "${action.text}"`;
    case "expect_url":
      return `be at ${action.path}`;
    case "expect_visible":
      return `see ${action.testId ? `[${action.testId}]` : `"${action.text}"`}`;
    case "expect_response":
      return `get ${action.status} from ${action.method} ${action.path}`;
  }
}

/** JSON with object keys sorted at every level: Postgres jsonb does not keep key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The worker's own normalisation of an action: an upper-case method. */
const normal = (a: StepAction): StepAction => (a.type === "expect_response" ? { ...a, method: a.method.toUpperCase() } : a);

/** Does a stored scenario already say what the declared one says? */
export function sameScenario(
  stored: { expected: string; steps: { text: string; action: StepAction }[] },
  declared: { expected?: string; steps: { text: string; action: StepAction }[] },
): boolean {
  const shape = (steps: { text: string; action: StepAction }[]) => canonical(steps.map((s) => ({ text: s.text.trim(), action: normal(s.action) })));
  return stored.expected === (declared.expected ?? "").trim() && shape(stored.steps) === shape(declared.steps);
}

/** The process exit code: a failing scenario fails the job, so the pipeline shows it. */
export function exitCode(verdicts: readonly Verdict[]): number {
  return verdicts.includes("fails") || verdicts.includes("errored") ? 1 : 0;
}
