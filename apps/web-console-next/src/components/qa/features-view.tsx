"use client";

import * as React from "react";
import Link from "next/link";
import type { FeatureHealth, PublicArea, PublicFeature } from "@saas/contracts/qa";

/**
 * The Features home, mirroring the design canvas (Feature catalog · home)
 * element for element. Pure: data and links come in as props, so the page and
 * the /demo/qa preview render the same markup.
 */

export const HEALTH_PILL: Record<FeatureHealth, { cls: string; label: string }> = {
  verified: { cls: "pill ok", label: "Verified" },
  attention: { cls: "pill warn", label: "Needs attention" },
  broken: { cls: "pill bad", label: "Broken" },
  not_tested: { cls: "pill neutral", label: "Not tested yet" },
};

const ORDER: FeatureHealth[] = ["verified", "attention", "broken", "not_tested"];
const BAR: Record<FeatureHealth, string> = { verified: "#3A8159", attention: "#C39B45", broken: "#C94A44", not_tested: "#D6D2C8" };
const COUNT_COLOR: Record<FeatureHealth, string | undefined> = { verified: "#2C6644", attention: "#7A6320", broken: "#A33A35", not_tested: undefined };
const COUNT_WORD: Record<FeatureHealth, string> = { verified: "verified", attention: "need attention", broken: "broken", not_tested: "not tested yet" };

export interface NeedsYouItem {
  kind: "bad" | "warn" | "info";
  label: string;
  text: string;
  href: string;
}

export interface FeaturesViewProps {
  productName: string;
  features: PublicFeature[];
  areas: PublicArea[];
  needsYou: NeedsYouItem[];
  lastCheck: string | null;
  featureHref: (featureId: string) => string;
  planHref: string;
  testsHref: string;
  onAddFeature?: () => void;
  /** Scenarios arrive in QA2; until then the console hides "Add a scenario". */
  showAddScenario?: boolean;
}

export function FeaturesView({ productName, features, areas, needsYou, lastCheck, featureHref, planHref, testsHref, onAddFeature, showAddScenario = false }: FeaturesViewProps) {
  const [filter, setFilter] = React.useState<FeatureHealth | "all">("all");
  const [query, setQuery] = React.useState("");

  const counts = ORDER.reduce((acc, h) => ({ ...acc, [h]: features.filter((f) => f.health === h).length }), {} as Record<FeatureHealth, number>);
  const q = query.trim().toLowerCase();
  const shown = features.filter((f) => (filter === "all" || f.health === filter) && (!q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)));
  const groups = [
    ...areas.map((a) => ({ key: a.id, name: a.name, items: shown.filter((f) => f.areaId === a.id) })),
    { key: "none", name: "Not in an area yet", items: shown.filter((f) => !f.areaId || !areas.some((a) => a.id === f.areaId)) },
  ].filter((g) => g.items.length > 0);
  const filterLabels: Record<FeatureHealth | "all", string> = { all: "All", verified: "Verified", attention: "Needs attention", broken: "Broken", not_tested: "Not tested yet" };

  return (
    // The Features artboard sits 8px lower than the other screens (40px vs 32px).
    <div className="qa" style={{ paddingTop: 8 }}>
      <section style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 32 }}>
        <div style={{ flex: "999 1 520px", minWidth: 0 }}>
          <div className="eyebrow">
            {productName} · {features.length} {features.length === 1 ? "feature" : "features"}
          </div>
          <h1 className="serif" style={{ margin: "8px 0 12px", fontSize: 48, lineHeight: 1.08, fontWeight: 500, letterSpacing: "-0.01em" }}>
            Every feature, shown working.
          </h1>
          <p className="muted" style={{ margin: "0 0 20px", fontSize: 17, maxWidth: 620 }}>
            Every feature of the product, how each one connects to the rest, and — once scenarios run — the recording that proves it works.
          </p>
          {features.length > 0 && (
            <>
              <div
                style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", maxWidth: 640, gap: 3 }}
                role="img"
                aria-label={`Feature health: ${ORDER.map((h) => `${counts[h]} ${COUNT_WORD[h]}`).join(", ")}`}
              >
                {ORDER.filter((h) => counts[h] > 0).map((h) => (
                  <div key={h} style={{ flex: `${counts[h]} 1 0`, background: BAR[h] }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10, fontSize: 14, color: "#4A4843" }}>
                {ORDER.map((h) => (
                  <span key={h}>
                    <b style={COUNT_COLOR[h] ? { color: COUNT_COLOR[h] } : undefined}>{counts[h]}</b> {COUNT_WORD[h]}
                  </span>
                ))}
                <span style={{ color: "#6E6E68" }}>{lastCheck ? `Last full check ${lastCheck}` : "No full check has run yet"}</span>
              </div>
            </>
          )}
        </div>
        <div className="card" style={{ flex: "1 1 320px", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Needs you today</div>
          {needsYou.length === 0 ? (
            <span className="muted" style={{ fontSize: 14 }}>
              Nothing right now.
            </span>
          ) : (
            needsYou.map((n) => (
              <Link key={n.href + n.text} href={n.href} style={{ display: "flex", gap: 12, alignItems: "flex-start", textDecoration: "none", color: "#171717" }}>
                <span className={`pill ${n.kind}`}>
                  <i />
                  {n.label}
                </span>
                <span style={{ fontSize: 14 }}>{n.text}</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Filter by health">
          {(["all", ...ORDER] as const).map((h) => (
            <button key={h} type="button" className={filter === h ? "chip on" : "chip"} aria-pressed={filter === h} onClick={() => setFilter(h)}>
              {filterLabels[h]} · {h === "all" ? features.length : counts[h]}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="fsearch" style={{ position: "absolute", left: -9999 }}>
            Search features
          </label>
          <input id="fsearch" type="search" placeholder="Search features" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 260, borderRadius: 999 }} />
          {showAddScenario && (
            <Link className="btn" href={testsHref}>
              Add a scenario
            </Link>
          )}
          {onAddFeature ? (
            <button type="button" className="btn primary" onClick={onAddFeature}>
              Add a feature
            </button>
          ) : (
            <Link className="btn primary" href={planHref}>
              Plan a new feature
            </Link>
          )}
        </div>
      </section>

      {features.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div className="serif" style={{ fontSize: 24, marginBottom: 6 }}>
            No features yet
          </div>
          <p className="muted" style={{ margin: "0 0 16px" }}>
            Add the things a customer can do. Each one gets scenarios, a recording, and its place on the map.
          </p>
          {onAddFeature && (
            <button type="button" className="btn primary" onClick={onAddFeature}>
              Add a feature
            </button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">No feature matches.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} style={{ marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <h2 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 500 }}>
                {g.name}
              </h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(290px, 100%), 1fr))", gap: 20 }}>
              {g.items.map((f) => (
                <FeatureCard key={f.id} feature={f} href={featureHref(f.id)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** The design's player frame. Until a scenario has run there is no recording, and it says so. */
export function RecordingFrame({ big = false, caption }: { big?: boolean; caption?: string }) {
  return (
    <div className={big ? "demo big" : "demo"}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "#E9E6DF",
          fontSize: big ? 16 : 13,
          textAlign: "center",
          padding: 16,
        }}
      >
        <svg width={big ? 28 : 22} height={big ? 28 : 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
        </svg>
        {caption ?? "The recording appears after the first verified run"}
      </div>
    </div>
  );
}

function FeatureCard({ feature: f, href }: { feature: PublicFeature; href: string }) {
  const pill = HEALTH_PILL[f.health];
  return (
    <Link href={href} className="card" style={{ display: "flex", flexDirection: "column", textDecoration: "none", color: "#171717", overflow: "hidden", padding: 8 }}>
      <RecordingFrame />
      <div style={{ padding: "14px 8px 8px", display: "flex", flexDirection: "column", gap: 8, flex: "1 1 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{f.name}</span>
          <span className={pill.cls}>
            <i />
            {pill.label}
          </span>
        </div>
        {f.description && (
          <div className="muted" style={{ fontSize: 14 }}>
            {f.description}
          </div>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "#6E6E68", marginTop: "auto", paddingTop: 6 }}>
          <span>{f.specLinks.length > 0 ? f.specLinks.join(" · ") : "No spec linked"}</span>
        </div>
      </div>
    </Link>
  );
}
