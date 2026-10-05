import { chapterOffsets, clock } from "@web-console-next/components/qa/replay";
import { matchesCall } from "@web-console-next/components/qa/tests-view";

describe("the recording player", () => {
  it("reads chapters from the runner's step marks", () => {
    const events = [
      { type: 4, timestamp: 1000 },
      { type: 2, timestamp: 1010 },
      { type: 5, timestamp: 1010, data: { tag: "qa-step", payload: { ord: 0 } } },
      { type: 5, timestamp: 4010, data: { tag: "qa-step", payload: { ord: 1 } } },
      { type: 5, timestamp: 9000, data: { tag: "qa-end", payload: {} } },
    ];
    expect([...chapterOffsets(events, [])]).toEqual([
      [0, 10],
      [1, 3010],
    ]);
  });

  it("falls back to step timings, aligned on the first step", () => {
    const timings = [
      { ord: 0, startMs: 40, endMs: 200, ok: true },
      { ord: 1, startMs: 200, endMs: 900, ok: false },
    ];
    expect([...chapterOffsets([{ type: 4, timestamp: 5 }], timings)]).toEqual([
      [0, 0],
      [1, 160],
    ]);
  });

  it("shows minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(15_682)).toBe("0:16");
    expect(clock(75_000)).toBe("1:15");
  });
});

describe("APIs checked behind the scenes", () => {
  const check = { type: "expect_response" as const, method: "get", path: "/v1/organizations/{orgId}/qa/hubs/{hub}/map", status: 200 };
  it("matches a call by method, status and path, a placeholder standing for one segment", () => {
    expect(matchesCall(check, { method: "GET", path: "/v1/organizations/org_1/qa/hubs/hub_1/map", status: 200, ms: 40 })).toBe(true);
    expect(matchesCall(check, { method: "GET", path: "/v1/organizations/org_1/qa/hubs/hub_1/map", status: 500, ms: 40 })).toBe(false);
    expect(matchesCall(check, { method: "GET", path: "/v1/organizations/org_1/qa/hubs/map", status: 200, ms: 40 })).toBe(false);
  });
});
