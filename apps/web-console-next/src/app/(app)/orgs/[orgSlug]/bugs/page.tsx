"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="Bugs · synced with your tracker"
      title="What's not working"
      description="Every failure found on stage becomes a full bug report — what happened, what should happen, the recording and the steps — assigned to whoever last changed that feature."
      milestone="QA3 — bugs, trackers and developer verification"
      what={["A bug opened automatically from a failing scenario, with its recording", "Linear and Jira kept in step: fixed in the tracker re-runs the scenario", "What else breaks, from the dependency map"]}
    />
  );
}
