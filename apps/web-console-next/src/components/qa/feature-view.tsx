"use client";

import * as React from "react";
import Link from "next/link";
import type { FeatureRipple, PublicArea, PublicFeature, PublicResult, PublicScenario, StepAction } from "@saas/contracts/qa";
import { HEALTH_PILL, RecordingFrame } from "@/components/qa/features-view";
import { RecordingPlayer, clock } from "@/components/qa/replay";

/**
 * The feature page, mirroring the design canvas (Feature · recorded demo,
 * step by step, scenarios, ripple). Pure: data, links and actions come in as
 * props. The player shows the selected scenario's newest recording, or its last
 * verified one.
 */

export type FeaturePatch = Partial<Pick<PublicFeature, "description" | "areaId" | "public">>;

export interface FeatureViewProps {
  feature: PublicFeature;
  ripple: FeatureRipple;
  areas: PublicArea[];
  names: Record<string, string>;
  featuresHref: string;
  featureHref: (id: string) => string;
  insightsHref: string;
  onSave?: (patch: FeaturePatch, label: string) => Promise<boolean>;
  /** The feature's scenarios with their newest result; null while loading. */
  scenarios: PublicScenario[] | null;
  selectedScenarioId: string | null;
  onSelectScenario: (id: string) => void;
  /** The selected scenario's results, newest first. */
  history: PublicResult[];
  loadRecording: (recordingId: string) => Promise<string>;
  /** The PM's sign-off on a draft scenario. */
  onApprove?: (scenario: PublicScenario) => Promise<void>;
}

const VERDICT_PILL = {
  works: { cls: "pill ok", label: "Works" },
  fails: { cls: "pill bad", label: "Fails" },
  errored: { cls: "pill warn", label: "Could not run" },
  skipped: { cls: "pill neutral", label: "Skipped" },
} as const;

/** How a step reads under its title in the chapter list. */
function stepNote(a: StepAction): string {
  switch (a.type) {
    case "goto":
      return "Opens the page";
    case "click":
      return "A click";
    case "fill":
      return "Types into a field";
    case "press":
      return `Presses ${a.key}`;
    case "expect_text":
    case "expect_visible":
      return "Checks what is on screen";
    case "expect_url":
      return "Checks where it landed";
    case "expect_response":
      return `Checks ${a.method} ${a.path.replace(/\{[^}]+\}/g, "…")} answers ${a.status}`;
  }
}

const whenText = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? `today ${time}` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** A date in the viewer's own locale and time zone (the server's may differ, so hydration tolerates it). */
function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {whenText(iso)}
    </time>
  );
}

const CHAIN = {
  self: { bg: "#FBEBEA", border: "#EBC3BF", note: "#8E2F2A" },
  direct: { bg: "#FBEBEA", border: "#EBC3BF", note: "#8E2F2A" },
  next: { bg: "#FBF5E6", border: "#E8D9B0", note: "#7A6320" },
  relies: { bg: "#EAF3ED", border: "#C9DFD0", note: "#2C6644" },
} as const;

function ChainItem({ name, note, tone, href }: { name: string; note: string; tone: keyof typeof CHAIN; href?: string }) {
  const t = CHAIN[tone];
  const style: React.CSSProperties = { padding: "14px 16px", borderRadius: 14, background: t.bg, border: `1px solid ${t.border}`, minWidth: 180, textDecoration: "none", color: "#171717" };
  const body = (
    <>
      <div style={{ fontWeight: 600 }}>{name}</div>
      <div style={{ fontSize: 13, color: t.note }}>{note}</div>
    </>
  );
  return href ? (
    <Link href={href} style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  );
}

const Arrow = () => (
  <div aria-hidden="true" style={{ display: "flex", alignItems: "center", color: "#8A857A", fontSize: 20 }}>
    ›
  </div>
);

export function FeatureView({
  feature,
  ripple,
  areas,
  names,
  featuresHref,
  featureHref,
  insightsHref,
  onSave,
  scenarios,
  selectedScenarioId,
  onSelectScenario,
  history,
  loadRecording,
  onApprove,
}: FeatureViewProps) {
  const [description, setDescription] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // The recording choice belongs to one scenario: another scenario opens on its newest.
  const [choice, setChoice] = React.useState<{ scenario: string | null; which: "latest" | "verified" }>({ scenario: null, which: "latest" });
  const [seekTo, setSeekTo] = React.useState<{ ord: number; nonce: number } | null>(null);
  const [playingStep, setPlayingStep] = React.useState<number | null>(null);
  const [approving, setApproving] = React.useState<string | null>(null);
  const onStep = React.useCallback((ord: number | null) => setPlayingStep(ord), []);

  const selected = scenarios?.find((s) => s.id === selectedScenarioId) ?? null;
  const latest = history[0] ?? selected?.last ?? null;
  const verified = history.find((r) => r.verdict === "works" && r.recordingId) ?? null;
  const which = choice.scenario === selectedScenarioId ? choice.which : "latest";
  const setWhich = (w: "latest" | "verified") => setChoice({ scenario: selectedScenarioId, which: w });
  // With no recording on the newest result, show the last verified one rather than nothing.
  const shown = (which === "verified" || !latest?.recordingId) && verified ? verified : latest;
  // A chapter jump belongs to the recording it was made on.
  const shownKey = `${selectedScenarioId}:${shown?.recordingId ?? "none"}`;
  const [jumpKey, setJumpKey] = React.useState(shownKey);
  if (jumpKey !== shownKey) {
    setJumpKey(shownKey);
    setSeekTo(null);
    setPlayingStep(null);
  }
  const recordingChoices = [
    latest?.recordingId
      ? {
          id: "latest" as const,
          label: (
            <>
              {latest.verdict === "works" ? "Newest · verified " : latest.verdict === "fails" ? "Newest · failed " : "Newest · could not run "}
              <When iso={latest.createdAt} />
            </>
          ),
        }
      : null,
    verified && verified.id !== latest?.id
      ? {
          id: "verified" as const,
          label: (
            <>
              Last verified · <When iso={verified.createdAt} />
            </>
          ),
        }
      : null,
  ].filter((x): x is { id: "latest" | "verified"; label: React.ReactElement } => x !== null);
  const working = (scenarios ?? []).filter((s) => s.state === "approved" && s.last?.verdict === "works").length;
  const counted = (scenarios ?? []).filter((s) => s.state === "approved").length;
  const pill = HEALTH_PILL[feature.health];
  const area = areas.find((a) => a.id === feature.areaId);
  const text = description ?? feature.description;
  const name = (id: string) => names[id] ?? "A feature";

  const save = async (patch: FeaturePatch, label: string) => {
    if (!onSave) return;
    setSaving(true);
    const ok = await onSave(patch, label);
    setSaving(false);
    if (ok) setDescription(null);
  };

  const affected = ripple.breaksDirectly.length + ripple.breaksNext.length;

  return (
    <div className="qa">
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href={featuresHref}>Features</Link>
        <span style={{ color: "#6E6E68" }}>/</span>
        <span className="muted">{area?.name ?? "Not in an area yet"}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div>
          <h1 className="serif" style={{ margin: "0 0 8px", fontSize: 40, lineHeight: 1.1, fontWeight: 500 }}>
            {feature.name}
          </h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className={pill.cls}>
              <i />
              {pill.label}
            </span>
            {feature.health === "not_tested" && (
              <span className="muted" style={{ fontSize: 14 }}>
                No approved scenario has run for it yet
              </span>
            )}
            {feature.health !== "not_tested" && counted > 0 && (
              <span className="muted" style={{ fontSize: 14 }}>
                {working} of {counted} scenarios working
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href={insightsHref}>
            See it on the map
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 24 }}>
          <section className="card" style={{ padding: 10 }}>
            {recordingChoices.length > 0 && (
              <div style={{ display: "flex", gap: 4, padding: "4px 4px 10px", flexWrap: "wrap" }} role="group" aria-label="Which recording">
                {recordingChoices.map((c) => (
                  <button key={c.id} type="button" className={(shown === latest ? "latest" : "verified") === c.id ? "chip on" : "chip"}
                    aria-pressed={(shown === latest ? "latest" : "verified") === c.id} onClick={() => setWhich(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {selected && shown?.recordingId ? (
              <RecordingPlayer
                key={shown.recordingId}
                big
                load={() => loadRecording(shown.recordingId!)}
                steps={selected.steps}
                timings={shown.stepTimings}
                verdict={shown.verdict}
                failingStep={shown.failingStep}
                recordedBy={
                  <>
                    Recorded on stage by the runner · <When iso={shown.createdAt} />
                  </>
                }
                seekTo={seekTo}
                onStep={onStep}
              />
            ) : (
              <RecordingFrame
                big
                caption={
                  scenarios === null
                    ? "Loading the scenarios…"
                    : selected
                      ? "This scenario has not been recorded yet. Its recording appears after its next run."
                      : "The recording of this feature working appears here after its first verified run"
                }
              />
            )}
          </section>

          {selected && (
            <section>
              <h2 className="serif" style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 500 }}>
                Step by step
              </h2>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
                {selected.steps.map((st) => {
                  const timing = shown?.stepTimings.find((t) => t.ord === st.ord);
                  const failedHere = shown?.failingStep === st.ord && shown.verdict !== "works";
                  const notReached = shown !== null && shown !== undefined && shown.verdict !== "works" && shown.failingStep !== null && st.ord > shown.failingStep;
                  const state = !shown ? { cls: "pill neutral", label: "Not run" } : failedHere ? { cls: "pill bad", label: "Fails here" } : notReached ? { cls: "pill neutral", label: "Not reached" } : timing?.ok ? { cls: "pill ok", label: "Works" } : { cls: "pill neutral", label: "Not run" };
                  const on = playingStep === st.ord;
                  const t0 = shown?.stepTimings[0]?.startMs ?? 0;
                  return (
                    <li key={st.ord}>
                      <button
                        type="button"
                        onClick={() => setSeekTo({ ord: st.ord, nonce: Date.now() })}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          padding: "14px 16px",
                          borderRadius: 14,
                          border: `1px solid ${on ? "#171717" : "#E6E3DC"}`,
                          background: on ? "#FFFFFF" : "#FBFAF8",
                          cursor: "pointer",
                          font: "15px 'Hanken Grotesk', system-ui, sans-serif",
                          color: "#171717",
                          minHeight: 112,
                          boxSizing: "border-box",
                        }}
                      >
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%" }}>
                          <span className="mono" style={{ color: "#6E6E68" }}>
                            {timing ? clock(timing.startMs - t0) : `${st.ord + 1}`}
                          </span>
                          <span className={state.cls}>
                            <i />
                            {state.label}
                          </span>
                        </span>
                        <span style={{ fontWeight: 600 }}>{st.text}</span>
                        <span className="muted" style={{ fontSize: 13 }}>
                          {stepNote(st.action)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {shown && shown.verdict !== "works" && shown.message && (
            <section style={{ padding: "20px 22px", borderRadius: 16, background: "#FBEBEA", border: "1px solid #EBC3BF" }}>
              <div style={{ fontWeight: 700, color: "#8E2F2A", marginBottom: 6 }}>What went wrong, in plain words</div>
              <div style={{ fontSize: 16, color: "#3B1D1B" }}>{shown.message}</div>
            </section>
          )}

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <h2 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>
                Scenarios checked
              </h2>
              <span className="muted" style={{ fontSize: 14 }}>
                {scenarios === null ? "Loading…" : counted === 0 ? "None approved yet" : `${working} of ${counted} working`}
              </span>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              {scenarios !== null && scenarios.length === 0 && (
                <div style={{ padding: "16px 18px" }}>
                  <span className="muted" style={{ fontSize: 14 }}>
                    No scenario checks this feature yet.
                  </span>
                </div>
              )}
              {(scenarios ?? []).map((sc, i) => {
                const v = sc.last ? VERDICT_PILL[sc.last.verdict] : null;
                const pill = sc.state === "draft" ? { cls: "pill warn", label: "Awaiting approval" } : sc.state === "quarantined" ? { cls: "pill neutral", label: "Paused" } : (v ?? { cls: "pill neutral", label: "Not run yet" });
                const on = sc.id === selectedScenarioId;
                return (
                  <div
                    key={sc.id}
                    style={{
                      display: "flex",
                      gap: 16,
                      alignItems: "center",
                      padding: "16px 18px",
                      borderBottom: i === (scenarios ?? []).length - 1 ? 0 : "1px solid #EFEDE8",
                      flexWrap: "wrap",
                      background: on ? "#FBFAF8" : "transparent",
                      boxShadow: on ? "inset 3px 0 0 #171717" : "none",
                    }}
                  >
                    {/* The row selects through its own button; Approve is a sibling, never nested. */}
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onSelectScenario(sc.id)}
                      style={{ flex: "1 1 320px", minWidth: 0, display: "flex", gap: 16, alignItems: "center", padding: 0, border: 0, background: "transparent", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
                    >
                      <span className={pill.cls}>
                        <i />
                        {pill.label}
                      </span>
                      <span style={{ flex: "1 1 240px", minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600 }}>{sc.name}</span>
                        {sc.expected && (
                          <span className="muted" style={{ display: "block", fontSize: 13 }}>
                            {sc.expected}
                          </span>
                        )}
                      </span>
                    </button>
                    {sc.state === "draft" && onApprove ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={approving === sc.id}
                        onClick={async () => {
                          setApproving(sc.id);
                          await onApprove(sc);
                          setApproving(null);
                        }}
                      >
                        Approve
                      </button>
                    ) : (
                      <span className="pill info">Runner · {sc.cadence === "daily" ? "daily" : sc.cadence === "release" ? "every release" : "on demand"}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="serif" style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 500 }}>
              When this breaks, these are affected
            </h2>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 14 }}>
              {affected === 0 ? "Nothing else depends on this feature yet." : "From the confirmed links on the dependency map."}
            </p>
            {affected > 0 && (
              <div style={{ display: "flex", alignItems: "stretch", gap: 10, flexWrap: "wrap" }}>
                <ChainItem name={feature.name} note="if this breaks" tone="self" />
                <Arrow />
                {ripple.breaksDirectly.map((id) => (
                  <ChainItem key={id} name={name(id)} note="breaks directly" tone="direct" href={featureHref(id)} />
                ))}
                {ripple.breaksNext.length > 0 && <Arrow />}
                {ripple.breaksNext.map((id) => (
                  <ChainItem key={id} name={name(id)} note="breaks next" tone="next" href={featureHref(id)} />
                ))}
              </div>
            )}
            <h3 style={{ margin: "20px 0 10px", fontSize: 15, fontWeight: 600 }}>It relies on</h3>
            {ripple.reliesOn.length === 0 ? (
              <span className="muted" style={{ fontSize: 14 }}>
                Nothing. This is a foundation.
              </span>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {ripple.reliesOn.map((id) => (
                  <ChainItem key={id} name={name(id)} note="needed by this feature" tone="relies" href={featureHref(id)} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              What it does
            </div>
            <label htmlFor="feature-description" style={{ position: "absolute", left: -9999 }}>
              What it does
            </label>
            <textarea
              id="feature-description"
              rows={5}
              value={text}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe it the way you would to a customer."
              style={{ width: "100%", marginBottom: 10 }}
            />
            <button type="button" className="btn primary" disabled={description === null || saving} onClick={() => save({ description: text }, "Description saved")}>
              Save
            </button>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              {history.length > 0 ? `Last ${Math.min(history.length, 14)} checks` : "Checks"}
            </div>
            {history.length === 0 ? (
              <span className="muted" style={{ fontSize: 14 }}>
                {selected ? "This scenario has not run yet. Each run adds a mark here." : "No checks have run yet. Each run will add a mark here."}
              </span>
            ) : (
              <>
                <div style={{ display: "flex", gap: 4 }} aria-label={`${history.slice(0, 14).filter((r) => r.verdict === "works").length} of the last ${Math.min(history.length, 14)} checks worked`}>
                  {history
                    .slice(0, 14)
                    .reverse()
                    .map((r) => (
                      <span key={r.id} title={`${VERDICT_PILL[r.verdict].label} · ${r.createdAt.slice(0, 10)}`} style={{ flex: "1 1 0", height: 28, borderRadius: 4, background: r.verdict === "works" ? "#3A8159" : r.verdict === "fails" ? "#C94A44" : "#C9C5BB" }} />
                    ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6E6E68", marginTop: 6 }}>
                  <When iso={history[Math.min(history.length, 14) - 1]!.createdAt} />
                  <When iso={history[0]!.createdAt} />
                </div>
              </>
            )}
          </div>

          <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="eyebrow">People and links</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span className="muted">Spec</span>
              {feature.specLinks.length > 0 ? (
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
                  {feature.specLinks.map((l) => (
                    <span key={l} className="pill neutral" title={l} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", lineHeight: "24px" }}>
                      {l}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="muted">None linked</span>
              )}
            </div>
            {feature.codeRefs.length > 0 && (
              <div style={{ fontSize: 14 }}>
                <span className="muted">Built in</span>
                <ul className="mono" style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", wordBreak: "break-all", color: "#4A4843" }}>
                  {feature.codeRefs.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="feature-area" style={{ fontSize: 14 }} className="muted">
                Area
              </label>
              <select
                id="feature-area"
                value={feature.areaId ?? ""}
                disabled={saving || !onSave}
                onChange={(e) => save({ areaId: e.target.value || null }, "Area changed")}
              >
                <option value="">Not in an area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <label htmlFor="feature-public" style={{ fontWeight: 600 }}>
                Show on public feature page
              </label>
              <input
                id="feature-public"
                type="checkbox"
                checked={feature.public}
                disabled={saving || !onSave}
                onChange={(e) => save({ public: e.target.checked }, e.target.checked ? "Now public" : "No longer public")}
                style={{ width: 20, height: 20 }}
              />
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
              The public page shows only verified recordings, so it appears there after its first verified run.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
