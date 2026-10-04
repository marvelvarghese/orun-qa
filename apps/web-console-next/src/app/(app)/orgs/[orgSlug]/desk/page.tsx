"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="Scenario desk · QA"
      title="Describe it. Then test it."
      description="QA writes scenarios in plain steps and chooses how to test them — by the AI, by hand with a recording, or later with the Chrome extension."
      milestone="QA2 — scenarios that run and record"
      what={["The queue the PM asked of you", "A scenario composer in plain steps", "AI runs, or your own report with a recording"]}
    />
  );
}
