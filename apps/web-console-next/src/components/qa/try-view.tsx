"use client";

import * as React from "react";
import Link from "next/link";
import type { PublicFeature, PublicTry, TryRole } from "@saas/contracts/qa";
import { TRY_LIMITS } from "@saas/contracts/qa";
import { RecordingFrame } from "@/components/qa/features-view";
import { RecordingPlayer } from "@/components/qa/replay";

/**
 * Try a scenario, mirroring the design canvas ("Try a scenario · run once,
 * save if useful"). A plain question is tried once on stage by the runner's AI;
 * the answer comes back with a recording, the steps it took and the APIs it
 * checked. Nothing is kept unless the person saves it as a scenario. Pure:
 * data and actions come in as props.
 */

export interface TryViewProps {
  features: PublicFeature[];
  recent: PublicTry[];
  /** The try on screen (the newest asked, or one picked from Recent). */
  current: PublicTry | null;
  /** Whether a runner job is on its way for the current try. */
  startingNow: boolean;
  asking: boolean;
  onAsk: (question: string, asRole: TryRole, featureId: string | null) => void;
  onPick: (tryId: string) => void;
  onSave: (t: PublicTry, featureId: string, name: string) => Promise<boolean>;
  loadRecording: (tryId: string) => Promise<string>;
  agentHref: string;
  /** Tries are answered for Orun QA's own workspace only. */
  available: boolean;
  /** Following the current try stopped (it took too long, or the page could not reach the API). */
  stale?: boolean;
}

const ANSWER_PILL = {
  yes: { cls: "pill ok", label: "Yes" },
  no: { cls: "pill warn", label: "No" },
  unclear: { cls: "pill neutral", label: "Unclear" },
} as const;

function statusPill(t: PublicTry): { cls: string; label: string } {
  if (t.status === "answered" && t.answer) return ANSWER_PILL[t.answer];
  if (t.status === "errored") return { cls: "pill bad", label: "Could not run" };
  if (t.status === "running") return { cls: "pill info", label: "Trying" };
  return { cls: "pill neutral", label: "Waiting" };
}

function ideasFor(features: PublicFeature[]): string[] {
  const names = features.map((f) => f.name);
  const ideas = [
    names[0] && `Does ${names[0]} work for someone who is not signed in?`,
    names[1] && `Can I find ${names[1]} from the features home?`,
    names[2] && `What breaks if ${names[2]} stops working?`,
  ].filter((x): x is string => !!x);
  return ideas.length > 0 ? ideas : ["Can a visitor open the features home without signing in?"];
}

function SaveForm({ t, features, onSave }: { t: PublicTry; features: PublicFeature[]; onSave: TryViewProps["onSave"] }) {
  const [open, setOpen] = React.useState(false);
  const [chosen, setFeatureId] = React.useState(t.featureId ?? "");
  // The features may arrive after the form: fall back to the first one shown.
  const featureId = chosen || features[0]?.id || "";
  const [name, setName] = React.useState(t.question.replace(/\?$/, "").slice(0, 120));
  const [saving, setSaving] = React.useState(false);
  if (t.savedScenarioId) return <span className="pill ok">Saved as a draft scenario</span>;
  if (!open) {
    return (
      <button type="button" className="btn primary" onClick={() => setOpen(true)} disabled={t.steps.length === 0}>
        Save as a scenario
      </button>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!featureId || !name.trim()) return;
        setSaving(true);
        const ok = await onSave(t, featureId, name.trim());
        setSaving(false);
        if (ok) setOpen(false);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", padding: 14, borderRadius: 12, background: "#F6F5F2" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="save-feature" style={{ fontWeight: 600, fontSize: 14 }}>
          Which feature does it check?
        </label>
        <select id="save-feature" value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="save-name" style={{ fontWeight: 600, fontSize: 14 }}>
          Name the scenario
        </label>
        <input id="save-name" type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn primary" disabled={saving || !featureId || !name.trim()}>
          Save as a draft
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        It keeps exactly the {t.steps.length} {t.steps.length === 1 ? "step" : "steps"} it took, and counts once you approve it.
      </span>
    </form>
  );
}

export function TryView({ features, recent, current, startingNow, asking, onAsk, onPick, onSave, loadRecording, agentHref, available, stale = false }: TryViewProps) {
  const [question, setQuestion] = React.useState("");
  const [asRole, setAsRole] = React.useState<TryRole>("owner");
  const [featureId, setFeatureId] = React.useState<string>("");
  const waiting = current !== null && (current.status === "queued" || current.status === "running");
  const ideas = React.useMemo(() => ideasFor(features), [features]);
  const checks = (current?.steps ?? []).filter((s) => s.action.type === "expect_response");
  const did = (current?.steps ?? []).filter((s) => s.action.type !== "expect_response");

  return (
    <div className="qa">
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow">Try a scenario · nothing is saved unless you choose</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 40, fontWeight: 500 }}>
          Does this work? Find out in a minute.
        </h1>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section className="card" style={{ flex: "1 1 380px", minWidth: 0, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) onAsk(question.trim(), asRole, featureId || null);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="try-question" style={{ fontWeight: 600 }}>
                What do you want to try?
              </label>
              <textarea
                id="try-question"
                rows={5}
                style={{ fontSize: 16 }}
                value={question}
                maxLength={TRY_LIMITS.questionMax}
                placeholder={ideas[0]}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="try-as" style={{ fontWeight: 600, fontSize: 14 }}>
                  Try it as
                </label>
                <select id="try-as" value={asRole} onChange={(e) => setAsRole(e.target.value as TryRole)}>
                  <option value="owner">The workspace owner</option>
                  <option value="visitor">A visitor, not signed in</option>
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="try-about" style={{ fontWeight: 600, fontSize: 14 }}>
                  About
                </label>
                <select id="try-about" value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
                  <option value="">Any feature</option>
                  {features.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className="btn primary" style={{ height: 48, fontSize: 15 }} disabled={!available || asking || !question.trim()}>
              {asking ? "Asking…" : waiting ? "Try another" : "Try it once"}
            </button>
          </form>
          <div className="muted" style={{ fontSize: 13 }}>
            {available
              ? "The AI clicks through it on stage like a customer and checks the APIs underneath. It never touches live customer data."
              : "Tries run on Orun QA's own workspace on stage, where the runner works."}
          </div>
          <div style={{ borderTop: "1px solid #EFEDE8", paddingTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Ideas
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ideas.map((idea) => (
                <button key={idea} type="button" className="chip" onClick={() => setQuestion(idea)} style={{ height: "auto", minHeight: 32, whiteSpace: "normal", textAlign: "left", padding: "6px 12px" }}>
                  {idea}
                </button>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid #EFEDE8", paddingTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Your recent tries
            </div>
            {recent.length === 0 ? (
              <span className="muted" style={{ fontSize: 14 }}>
                Nothing yet. Your tries appear here.
              </span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
                {recent.slice(0, 8).map((t) => {
                  const pill = statusPill(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onPick(t.id)}
                      aria-pressed={current?.id === t.id}
                      style={{ display: "flex", justifyContent: "space-between", gap: 8, border: 0, background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", fontWeight: current?.id === t.id ? 600 : 400 }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.question}</span>
                      <span className={pill.cls}>
                        <i />
                        {pill.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section style={{ flex: "999 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }} aria-live="polite">
          {current === null && (
            <div className="card" style={{ padding: 16 }}>
              <RecordingFrame big caption="Ask a question, and the recording of the AI trying it appears here" />
            </div>
          )}

          {waiting && current && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>
                  {current.status === "running" ? "Trying it now…" : startingNow ? "Starting the runner…" : "Waiting for the runner"}
                </span>
                <span className="pill info">
                  <i />
                  {current.asRole === "visitor" ? "As a visitor" : "Signed in as the owner"}
                </span>
              </div>
              <RecordingFrame
                big
                caption={
                  current.status === "running"
                    ? "The AI is clicking through it on stage. The recording appears when it answers."
                    : startingNow
                      ? "A runner is starting on stage; it usually begins within a minute."
                      : "It runs at the runner's next pass on stage."
                }
              />
              <p className="muted" style={{ margin: "10px 0 0", fontSize: 14 }}>
                “{current.question}”
              </p>
              {stale && (
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "#8E2F2A" }}>Still not answered. Reload the page to look again.</p>
              )}
            </div>
          )}

          {current?.status === "errored" && (
            <div style={{ padding: "20px 22px", borderRadius: 16, background: "#FBEBEA", border: "1px solid #EBC3BF" }}>
              <div style={{ fontWeight: 700, color: "#8E2F2A", marginBottom: 6 }}>It could not be tried</div>
              <div style={{ fontSize: 16, color: "#3B1D1B" }}>{current.message || "The runner could not answer it."}</div>
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
                “{current.question}”
              </p>
            </div>
          )}

          {current?.status === "answered" && current.answer && (
            <>
              <div className="card" style={{ padding: 24, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <span className={ANSWER_PILL[current.answer].cls}>
                    <i />
                    Answer
                  </span>
                  <div className="serif" style={{ fontSize: 30, lineHeight: 1.2, margin: "10px 0 8px" }}>
                    {current.headline}
                  </div>
                  <p className="muted" style={{ margin: "0 0 16px", fontSize: 15 }}>
                    {current.explanation}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <SaveForm key={current.id} t={current} features={features} onSave={onSave} />
                    <button type="button" className="btn" disabled title="Bugs arrive with Linear and Jira (QA3)">
                      Report as a bug
                    </button>
                    <Link className="btn" href={agentHref}>
                      Ask the agent why
                    </Link>
                  </div>
                </div>
                <div style={{ flex: "1 1 340px", minWidth: 0 }}>
                  {current.hasRecording ? (
                    <RecordingPlayer
                      key={current.id}
                      load={() => loadRecording(current.id)}
                      steps={current.steps.map((s, i) => ({ ord: i, text: s.text, action: s.action }))}
                      timings={current.stepTimings}
                      verdict={current.answer === "yes" ? "works" : "skipped"}
                      failingStep={null}
                      recordedBy="Recorded just now on stage"
                    />
                  ) : (
                    <RecordingFrame caption="No recording was kept for this try" />
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16 }}>
                <div className="card" style={{ padding: 20 }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>
                    What it did
                  </div>
                  {did.length === 0 ? (
                    <span className="muted" style={{ fontSize: 14 }}>
                      It answered from the API alone.
                    </span>
                  ) : (
                    <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
                      {did.map((s, i) => (
                        <li key={i}>{s.text}</li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="card" style={{ padding: 20 }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>
                    APIs it checked
                  </div>
                  {checks.length === 0 ? (
                    <span className="muted" style={{ fontSize: 14 }}>
                      It checked the screens only.
                    </span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {checks.map((s, i) => {
                        const a = s.action as Extract<typeof s.action, { type: "expect_response" }>;
                        return (
                          <div key={i} className="api">
                            <span className={a.status >= 400 ? "pill warn" : "pill ok"}>
                              <i />
                              {a.status >= 400 ? "Refused" : "Works"}
                            </span>
                            <span style={{ flex: "1 1 120px" }}>{s.text}</span>
                            <span className="mono" style={{ color: "#4A4843", overflowWrap: "anywhere" }}>
                              {a.method} {a.path.replace(/\{([^}]+)\}/g, (_, k: string) => `{${k.replace(/^feature:.*/, "feature")}}`)} · {a.status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
