"use client";

import * as React from "react";
import Link from "next/link";
import type { ApiCall, PublicFeature, PublicRun, PublicScenario, StepAction } from "@saas/contracts/qa";

/**
 * All tests: every scenario of the hub with its newest result, mirroring the
 * design canvas ("All tests · scenarios, expand to see APIs"). Open a row to
 * see what the customer does and the API calls checked behind the scenes.
 * Pure: data and links come in as props.
 */

export interface TestsViewProps {
  scenarios: PublicScenario[];
  features: PublicFeature[];
  lastRun: PublicRun | null;
  recordingHref: (scenario: PublicScenario) => string;
  tryHref: string;
  agentHref: string;
}

type Filter = "all" | "screens" | "api" | "failing";

type ApiCheck = Extract<StepAction, { type: "expect_response" }>;

const RESULT = {
  works: { cls: "pill ok", label: "Works" },
  fails: { cls: "pill bad", label: "Fails" },
  errored: { cls: "pill warn", label: "Could not run" },
  skipped: { cls: "pill neutral", label: "Skipped" },
} as const;

/** A step path pattern ({org}, {hub}…) matched against a call the page made, one segment per placeholder. */
export function matchesCall(check: ApiCheck, call: ApiCall): boolean {
  if (call.method.toUpperCase() !== check.method.toUpperCase() || call.status !== check.status) return false;
  const want = check.path.split("?")[0]!.replace(/\/+$/, "").split("/");
  const got = call.path.split("?")[0]!.replace(/\/+$/, "").split("/");
  return want.length === got.length && want.every((seg, i) => seg === "*" || /^\{[^}]+\}$/.test(seg) || seg === got[i]);
}

const shownPath = (p: string) => p.replace(/\{([^}]+)\}/g, (_, k: string) => `{${k.replace(/^feature:.*/, "feature")}}`);

/**
 * A check's state comes from the run's own step verdicts; the recorded calls
 * only add the detail (status and time), since the same endpoint may be hit
 * more than once.
 */
function apiState(sc: PublicScenario, check: ApiCheck, ord: number): { cls: string; label: string; tech: string } {
  const tech = `${check.method.toUpperCase()} ${shownPath(check.path)}`;
  const last = sc.last;
  if (!last) return { cls: "pill neutral", label: "Not run", tech: `${tech} · expects ${check.status}` };
  const sameEndpoint = last.apiCalls.filter((c) => matchesCall({ ...check, status: c.status }, c));
  if (last.failingStep === ord && last.verdict !== "works") {
    const wrong = sameEndpoint.find((c) => c.status !== check.status);
    return { cls: "pill bad", label: "Fails", tech: wrong ? `${tech} · ${wrong.status}, expected ${check.status}` : `${tech} · not called, expected ${check.status}` };
  }
  if (last.failingStep !== null && last.verdict !== "works" && ord > last.failingStep) return { cls: "pill neutral", label: "Skipped", tech: `${tech} · not reached` };
  const timing = last.stepTimings.find((t) => t.ord === ord);
  if (timing?.ok || (last.verdict === "works" && !timing)) {
    const call = sameEndpoint.find((c) => c.status === check.status);
    return { cls: "pill ok", label: "Works", tech: call ? `${tech} · ${call.status} · ${call.ms} ms` : `${tech} · ${check.status}` };
  }
  return { cls: "pill neutral", label: "Not run", tech: `${tech} · expects ${check.status}` };
}

const cadence = (c: PublicScenario["cadence"]) => (c === "daily" ? "daily" : c === "release" ? "every release" : "on demand");

function Row({ sc, featureName, open, onToggle, recordingHref }: { sc: PublicScenario; featureName: string; open: boolean; onToggle: () => void; recordingHref: string }) {
  const result =
    sc.state === "draft"
      ? { cls: "pill warn", label: "To approve" }
      : sc.state === "quarantined"
        ? { cls: "pill neutral", label: "Paused" }
        : sc.last
          ? RESULT[sc.last.verdict]
          : { cls: "pill neutral", label: "Not run" };
  const checks = sc.steps.flatMap((s) => (s.action.type === "expect_response" ? [{ ord: s.ord, text: s.text, check: s.action }] : []));
  const customerSteps = sc.steps.filter((s) => s.action.type !== "expect_response");
  const summary = [sc.kind === "api_only" ? null : `${customerSteps.length} ${customerSteps.length === 1 ? "step" : "steps"}`, `${checks.length} API ${checks.length === 1 ? "check" : "checks"}`]
    .filter(Boolean)
    .join(" · ");
  const id = `test-${sc.id}`;
  return (
    <div style={{ borderBottom: "1px solid #EFEDE8" }}>
      <button type="button" className="row" onClick={onToggle} aria-expanded={open} aria-controls={open ? id : undefined}>
        <span className={result.cls} style={{ minWidth: 76, justifyContent: "center" }}>
          <i />
          {result.label}
        </span>
        <span style={{ flex: "1 1 260px", minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 600 }}>{sc.name}</span>
          <span style={{ display: "block", fontSize: 13, color: "#6E6E68" }}>
            {featureName} · {summary}
          </span>
        </span>
        <span className="pill neutral">{sc.kind === "api_only" ? "API only" : "Screens + APIs"}</span>
        <span className="pill info">Runner · {cadence(sc.cadence)}</span>
        <span style={{ fontSize: 18, color: "#6E6E68", width: 16, textAlign: "center" }} aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div id={id} style={{ padding: "4px 20px 20px", display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              What the customer does
            </div>
            {customerSteps.length > 0 ? (
              <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
                {customerSteps.map((s) => (
                  <li key={s.ord}>{s.text}</li>
                ))}
              </ol>
            ) : (
              <div className="muted" style={{ fontSize: 14 }}>
                API only. No screens involved.
              </div>
            )}
            {sc.last?.recordingId && (
              <Link href={recordingHref} style={{ display: "inline-block", marginTop: 10, fontSize: 14 }}>
                Watch the recording
              </Link>
            )}
            {sc.last && sc.last.verdict !== "works" && sc.last.message && (
              <p style={{ margin: "10px 0 0", fontSize: 14, color: "#8E2F2A" }}>{sc.last.message}</p>
            )}
          </div>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              APIs checked behind the scenes
            </div>
            {checks.length === 0 ? (
              <div className="muted" style={{ fontSize: 14 }}>
                This scenario checks the screens only.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {checks.map((c) => {
                  const st = apiState(sc, c.check, c.ord);
                  return (
                    <div key={c.ord} className="api">
                      <span className={st.cls}>
                        <i />
                        {st.label}
                      </span>
                      <span style={{ flex: "1 1 160px", minWidth: 0 }}>{c.text}</span>
                      <span className="mono" style={{ color: "#4A4843", overflowWrap: "anywhere" }}>
                        {st.tech}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TestsView({ scenarios, features, lastRun, recordingHref, tryHref, agentHref }: TestsViewProps) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [open, setOpen] = React.useState<string | null>(null);
  const featureName = React.useMemo(() => new Map(features.map((f) => [f.id, f.name])), [features]);

  const approved = scenarios.filter((s) => s.state === "approved");
  const working = approved.filter((s) => s.last?.verdict === "works").length;
  // "Not working" means an approved scenario whose newest result did not pass — the rows that say so.
  const failing = (s: PublicScenario) => s.state === "approved" && s.last !== null && (s.last.verdict === "fails" || s.last.verdict === "errored");
  const notWorking = scenarios.filter(failing).length;
  const apiChecks = scenarios.reduce((n, s) => n + s.steps.filter((st) => st.action.type === "expect_response").length, 0);
  const keep = (s: PublicScenario) =>
    filter === "all" ||
    (filter === "screens" && s.kind === "screens_apis") ||
    (filter === "api" && s.kind === "api_only") ||
    (filter === "failing" && failing(s));
  const filters: [Filter, string][] = [
    ["all", `All · ${scenarios.length}`],
    ["screens", "Screens + APIs"],
    ["api", "API only"],
    ["failing", `Not working · ${notWorking}`],
  ];
  const shown = scenarios.filter(keep);

  return (
    <div className="qa">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">All tests · one place</div>
          <h1 className="serif" style={{ margin: "6px 0 8px", fontSize: 40, fontWeight: 500 }}>
            Every scenario, and what it checked
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 16 }}>
            Screen tests and API tests live together. Open any scenario to see the steps a customer takes and the API calls behind each one.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href={tryHref}>
            Just try one
          </Link>
          <a className="btn primary" href="#add">
            Add a scenario
          </a>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="serif" style={{ fontSize: 34 }}>
            {working} <span style={{ fontSize: 18, color: "#5E5C57" }}>of {approved.length}</span>
          </div>
          <div className="muted">scenarios working</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div className="serif" style={{ fontSize: 34 }}>
            {apiChecks}
          </div>
          <div className="muted">API checks inside them</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div className="serif" style={{ fontSize: 34 }}>
            {lastRun ? (
              <time dateTime={lastRun.startedAt} suppressHydrationWarning>
                {new Date(lastRun.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </time>
            ) : (
              "—"
            )}
          </div>
          <div className="muted">{lastRun ? `last run, ${lastRun.trigger === "deploy" ? "after a deploy" : lastRun.trigger === "schedule" ? "every morning" : "by hand"}` : "no run yet"}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }} role="group" aria-label="Filter tests">
        {filters.map(([k, label]) => (
          <button key={k} type="button" className={k === filter ? "chip on" : "chip"} onClick={() => setFilter(k)} aria-pressed={k === filter}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section className="card" style={{ flex: "999 1 640px", minWidth: 0, overflow: "hidden" }}>
          {shown.length === 0 ? (
            <div style={{ padding: "16px 20px" }}>
              <span className="muted" style={{ fontSize: 14 }}>
                {scenarios.length === 0 ? "No scenarios yet. Add one, and it runs on stage with the next run." : "Nothing matches this filter."}
              </span>
            </div>
          ) : (
            shown.map((sc) => (
              <Row
                key={sc.id}
                sc={sc}
                featureName={featureName.get(sc.featureId) ?? "A feature"}
                open={open === sc.id}
                onToggle={() => setOpen(open === sc.id ? null : sc.id)}
                recordingHref={recordingHref(sc)}
              />
            ))
          )}
        </section>

        <aside id="add" style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Add a scenario for AI to test</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="add-feature" style={{ fontSize: 14, fontWeight: 600 }}>
                Feature
              </label>
              <select id="add-feature" disabled>
                {features.map((f) => (
                  <option key={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="add-describe" style={{ fontSize: 14, fontWeight: 600 }}>
                Describe it in plain words
              </label>
              <textarea id="add-describe" rows={4} disabled placeholder="A customer opens the features home and sees every area of the product." />
            </div>
            <button type="button" className="btn primary" disabled>
              Ask AI to write and run it
            </button>
            <div className="muted" style={{ fontSize: 13 }}>
              The AI writer arrives with Plan scenarios. Until then, scenarios are written alongside the code and approved here.
            </div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Not sure how to phrase it?</div>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
              Ask the agent. It knows every feature and test already here.
            </p>
            <Link className="btn" href={agentHref}>
              Ask the agent
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
