"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="Plan scenarios · before development starts"
      title="What should we prove works?"
      description="Describe a feature or pull it from your tracker; the AI drafts the scenarios that prove it works, and QA reviews them before anything runs."
      milestone="QA4 — planning and the release sign-off"
      what={["Type it, or pull an issue from Linear or Jira", "Acceptance criteria become scenarios; edge cases are suggested", "Questions the ticket does not answer, for you to settle"]}
    />
  );
}
