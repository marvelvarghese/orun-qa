"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="All tests · one place"
      title="Every scenario, and what it checked"
      description="Screen tests and API tests live together. Open any scenario to see the steps a customer takes and the API calls behind each one."
      milestone="QA2 — scenarios that run and record"
      what={["Every scenario with its last result and who tests it", "Expand one to see its steps and the API calls it checked", "Add a scenario for the AI to write and run"]}
    />
  );
}
