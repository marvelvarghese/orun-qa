"use client";

import * as React from "react";
import Link from "next/link";
import type { FeatureRipple, PublicArea, PublicFeature } from "@saas/contracts/qa";
import { HEALTH_PILL, RecordingFrame } from "@/components/qa/features-view";

/**
 * The feature page, mirroring the design canvas (Feature · recorded demo,
 * scenarios, ripple). Pure: data, links and the save action come in as props.
 * Recordings, chapters and scenario results arrive in QA2; until then their
 * places say so plainly.
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

export function FeatureView({ feature, ripple, areas, names, featuresHref, featureHref, insightsHref, onSave }: FeatureViewProps) {
  const [description, setDescription] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
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
                No scenario has run for it yet
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
            <RecordingFrame big caption="The recording of this feature working appears here after its first verified run" />
          </section>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <h2 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>
                Scenarios checked
              </h2>
              <span className="muted" style={{ fontSize: 14 }}>
                None yet
              </span>
            </div>
            <div className="card" style={{ padding: "16px 18px" }}>
              <span className="muted" style={{ fontSize: 14 }}>
                Scenarios, and who tested each one, appear here once they run (QA2).
              </span>
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
              Checks
            </div>
            <span className="muted" style={{ fontSize: 14 }}>
              No checks have run yet. Each run will add a mark here.
            </span>
          </div>

          <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="eyebrow">People and links</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span className="muted">Product owner</span>
              <span style={{ fontWeight: 600 }}>{feature.ownerUserId ?? "Not set"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span className="muted">QA</span>
              <span style={{ fontWeight: 600 }}>{feature.qaUserId ?? "Not set"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span className="muted">Spec</span>
              {feature.specLinks.length > 0 ? <span className="pill neutral">{feature.specLinks.join(" · ")}</span> : <span className="muted">None linked</span>}
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
