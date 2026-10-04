"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

/**
 * A screen from the design whose feature ships in a later milestone. It shows
 * the screen's heading and says plainly which milestone delivers it — no
 * sample data dressed up as real.
 */
export function ComingScreen({
  eyebrow,
  title,
  description,
  milestone,
  what,
}: {
  eyebrow: string;
  title: string;
  description: string;
  milestone: string;
  what: string[];
}) {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? "";
  const hub = useSearchParams()?.get("hub");
  const keep = hub ? `?hub=${encodeURIComponent(hub)}` : "";
  return (
    <div className="qa">
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="serif" style={{ margin: "6px 0 8px", fontSize: 40, fontWeight: 500, lineHeight: 1.15 }}>
          {title}
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: 16, maxWidth: 720 }}>
          {description}
        </p>
      </div>
      <div className="card" style={{ padding: 28, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <span className="pill info">
            <i />
            Arrives in {milestone}
          </span>
          <ul style={{ margin: "16px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {what.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
        <div style={{ flex: "0 1 300px", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="muted" style={{ fontSize: 14 }}>
            Until then, the feature map is live:
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn primary" href={`/orgs/${orgSlug}/features${keep}`}>
              Features
            </Link>
            <Link className="btn" href={`/orgs/${orgSlug}/insights${keep}`}>
              Insights
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
