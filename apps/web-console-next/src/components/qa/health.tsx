import { Badge } from "@/components/ui/badge";
import type { FeatureHealth } from "@saas/contracts/qa";

export const HEALTH_LABEL: Record<FeatureHealth, string> = {
  verified: "Verified",
  attention: "Needs attention",
  broken: "Broken",
  not_tested: "Not tested yet",
};

const VARIANT: Record<FeatureHealth, "success" | "warning" | "destructive" | "secondary"> = {
  verified: "success",
  attention: "warning",
  broken: "destructive",
  not_tested: "secondary",
};

export const HEALTH_ORDER: FeatureHealth[] = ["verified", "attention", "broken", "not_tested"];

export function HealthBadge({ health }: { health: FeatureHealth }) {
  return <Badge variant={VARIANT[health]}>{HEALTH_LABEL[health]}</Badge>;
}

/** The segmented bar at the top of the Features home. Each segment is labelled for screen readers. */
export function HealthBar({ counts }: { counts: Record<FeatureHealth, number> }) {
  const total = HEALTH_ORDER.reduce((n, h) => n + counts[h], 0);
  if (total === 0) return null;
  const color: Record<FeatureHealth, string> = {
    verified: "bg-success",
    attention: "bg-warning",
    broken: "bg-destructive",
    not_tested: "bg-muted-foreground/30",
  };
  return (
    <div className="space-y-2">
      <div
        className="flex h-3 w-full max-w-xl gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={HEALTH_ORDER.map((h) => `${counts[h]} ${HEALTH_LABEL[h].toLowerCase()}`).join(", ")}
      >
        {HEALTH_ORDER.filter((h) => counts[h] > 0).map((h) => (
          <div key={h} className={color[h]} style={{ flex: `${counts[h]} 1 0` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        {HEALTH_ORDER.map((h) => (
          <span key={h}>
            <span className="font-semibold text-foreground">{counts[h]}</span> {HEALTH_LABEL[h].toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
