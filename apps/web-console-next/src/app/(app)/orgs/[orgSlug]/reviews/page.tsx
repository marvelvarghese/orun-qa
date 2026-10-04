"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="Release review · your sign-off"
      title="Approve every change before production"
      description="When development finishes, every changed feature is shown here with its recording, its scenarios and what changed — and production waits for your approval."
      milestone="QA4 — planning and the release sign-off"
      what={["Before and after recordings for every change that looks or works differently", "Approve or request changes, one change at a time", "Production unlocks only when every change is approved"]}
    />
  );
}
