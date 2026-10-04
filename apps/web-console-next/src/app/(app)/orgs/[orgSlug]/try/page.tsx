"use client";

import { ComingScreen } from "@/components/qa/coming";

export default function Page() {
  return (
    <ComingScreen
      eyebrow="Try a scenario · nothing is saved unless you choose"
      title="Does this work? Find out in a minute."
      description="Ask a plain question, choose who to try it as, and get an answer with a recording, the steps it took and the APIs it checked."
      milestone="QA2 — scenarios that run and record"
      what={["Run once in a real browser on stage", "A plain answer, with the recording", "Save it as a scenario or report it as a bug"]}
    />
  );
}
