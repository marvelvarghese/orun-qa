"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="Ask the agent"
      title="Ask about any feature, test or bug"
      description="The agent answers from everything in this workspace, tries scenarios for you and drafts new ones for review."
      milestone="QA5 — the agent, MCP and the public page"
      what={["Answers grounded in your features, scenarios and bugs, with sources", "Try a scenario from the chat and see the recording", "Draft scenarios that go to QA for review"]}
    />
  );
}
