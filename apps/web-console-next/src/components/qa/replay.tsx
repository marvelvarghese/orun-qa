"use client";

import * as React from "react";
import type { PublicStep, StepTiming, Verdict } from "@saas/contracts/qa";

/**
 * The recording player: an rrweb DOM recording replayed inside the design's
 * 16:10 frame, with the step being shown as the caption, the failing step
 * marked on the timeline, and chapters to jump between steps.
 *
 * Recordings arrive gzip-compressed and base64-encoded; they are unpacked in
 * the browser (DecompressionStream) and replayed in rrweb's sandboxed iframe,
 * which never runs the recorded page's scripts.
 */

type RrwebEvent = { type: number; timestamp: number; data?: { tag?: string; payload?: { ord?: number } } };
type Replayer = {
  play(at?: number): void;
  pause(at?: number): void;
  getCurrentTime(): number;
  getMetaData(): { totalTime: number };
  on(event: string, fn: (payload?: unknown) => void): void;
  destroy(): void;
  wrapper: HTMLElement;
};

const CUSTOM = 5;
const META = 4;

export async function unpackRecording(b64: string): Promise<RrwebEvent[]> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const events = JSON.parse(await new Response(stream).text()) as RrwebEvent[];
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Where each step starts on the replay timeline (ms from the first event). The
 * runner marks steps with rrweb custom events; older recordings fall back to
 * the result's step timings, aligned on the first step.
 */
export function chapterOffsets(events: RrwebEvent[], timings: StepTiming[]): Map<number, number> {
  const out = new Map<number, number>();
  if (events.length === 0) return out;
  const t0 = events[0]!.timestamp;
  for (const e of events) {
    if (e.type === CUSTOM && e.data?.tag === "qa-step" && typeof e.data.payload?.ord === "number") out.set(e.data.payload.ord, Math.max(0, e.timestamp - t0));
  }
  if (out.size === 0 && timings.length > 0) {
    const base = timings[0]!.startMs;
    for (const t of timings) out.set(t.ord, Math.max(0, t.startMs - base));
  }
  return out;
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export interface RecordingPlayerProps {
  /** Fetch the recording's events (gzip + base64). */
  load: () => Promise<string>;
  steps: PublicStep[];
  timings: StepTiming[];
  verdict: Verdict;
  failingStep: number | null;
  recordedBy: React.ReactNode;
  big?: boolean;
  /** Ask the player to jump to a step (from the chapter list). */
  seekTo?: { ord: number; nonce: number } | null;
  onStep?: (ord: number | null) => void;
}

export function RecordingPlayer({ load, steps, timings, verdict, failingStep, recordedBy, big = false, seekTo, onStep }: RecordingPlayerProps) {
  const winRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<Replayer | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = React.useState(false);
  const [now, setNow] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [offsets, setOffsets] = React.useState<Map<number, number>>(new Map());
  // A jump asked for before this recording mounted belongs to another one.
  const mountedJump = React.useRef(seekTo?.nonce);

  // Load, unpack and mount the replayer once per recording.
  React.useEffect(() => {
    let cancelled = false;
    let replayer: Replayer | null = null;
    let observer: ResizeObserver | null = null;
    setState("loading");
    (async () => {
      try {
        const [{ Replayer: R }, b64] = await Promise.all([import("@rrweb/replay"), load()]);
        const events = await unpackRecording(b64);
        if (cancelled || !winRef.current) return;
        if (!events.some((e) => e.type === META)) throw new Error("not a recording");
        winRef.current.innerHTML = "";
        replayer = new R(events as never, { root: winRef.current, skipInactive: true, showWarning: false, mouseTail: false, triggerFocus: false }) as unknown as Replayer;
        playerRef.current = replayer;
        const fit = () => {
          const w = winRef.current;
          const iframe = replayer?.wrapper.querySelector("iframe");
          if (!w || !iframe || !replayer) return;
          const vw = Number(iframe.getAttribute("width")) || iframe.offsetWidth || 1;
          const vh = Number(iframe.getAttribute("height")) || iframe.offsetHeight || 1;
          const s = Math.min(w.clientWidth / vw, w.clientHeight / vh);
          Object.assign(replayer.wrapper.style, { transform: `scale(${s})`, transformOrigin: "top left", position: "absolute", left: `${(w.clientWidth - vw * s) / 2}px`, top: "0" });
        };
        replayer.on("resize", fit);
        replayer.on("finish", () => setPlaying(false));
        observer = new ResizeObserver(fit);
        observer.observe(winRef.current);
        fit();
        setOffsets(chapterOffsets(events, timings));
        setTotal(replayer.getMetaData().totalTime);
        // Open on the first full page, not the empty instant before it.
        const firstPage = events.find((e) => e.type === 2);
        replayer.pause(firstPage ? firstPage.timestamp - events[0]!.timestamp : 0);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      replayer?.destroy();
      playerRef.current = null;
    };
    // The recording is fixed for the life of this player; the parent re-keys it per result.
  }, []);

  // Follow the playhead while playing.
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const p = playerRef.current;
      if (p) setNow(Math.min(p.getCurrentTime(), total));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const current = React.useMemo(() => {
    let ord: number | null = null;
    for (const [o, at] of [...offsets.entries()].sort((a, b) => a[1] - b[1])) if (at <= now + 1) ord = o;
    return ord;
  }, [offsets, now]);

  React.useEffect(() => onStep?.(current), [current, onStep]);
  React.useEffect(() => () => onStep?.(null), [onStep]);

  const seek = React.useCallback(
    (ms: number, play: boolean) => {
      const p = playerRef.current;
      if (!p) return;
      const at = Math.max(0, Math.min(ms, total));
      if (play) p.play(at);
      else p.pause(at);
      setNow(at);
      setPlaying(play);
    },
    [total],
  );

  React.useEffect(() => {
    if (!seekTo || state !== "ready" || seekTo.nonce === mountedJump.current) return;
    const at = offsets.get(seekTo.ord);
    if (at !== undefined) seek(at, true);
  }, [seekTo, state, offsets, seek]);

  const toggle = () => {
    const p = playerRef.current;
    if (state !== "ready" || !p) return;
    if (playing) {
      // A plain pause keeps the frame; pause(time) would rebuild the page from the start.
      p.pause();
      setNow(Math.min(p.getCurrentTime(), total));
      setPlaying(false);
    } else seek(now >= total ? 0 : now, true);
  };

  const failed = verdict === "fails" || verdict === "errored";
  const failAt = failingStep !== null ? offsets.get(failingStep) : undefined;
  const caption = current !== null ? steps.find((s) => s.ord === current)?.text : steps[0]?.text;
  const pct = total > 0 ? (now / total) * 100 : 0;

  return (
    <>
      <div className={`demo${big ? " big" : ""}${failed ? " fail" : ""}`} style={{ cursor: state === "ready" ? "pointer" : "default" }} onClick={toggle}>
        <div className="win replay-win" ref={winRef} />
        {state !== "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#E9E6DF", fontSize: 14 }}>
            {state === "loading" ? "Loading the recording…" : "This recording could not be played"}
          </div>
        )}
        {caption && (
          <div className="cap">
            <span>{caption}</span>
          </div>
        )}
        <div className="pg">
          <i style={{ width: `${pct}%`, animation: "none" }} />
        </div>
        <span className="dur">{clock(total)}</span>
        <span className="tag">
          <i />
          {failed ? "Fails" : verdict === "works" ? "Works" : "Recorded"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 6px 4px", flexWrap: "wrap" }}>
        <button type="button" className="btn primary" aria-label={playing ? "Pause" : "Play"} style={{ width: 40, padding: 0 }} onClick={toggle} disabled={state !== "ready"}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <rect x="2" y="1" width="3.5" height="12" rx="1" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <path d="M3 1.5v11l9-5.5z" />
            </svg>
          )}
        </button>
        <span className="mono" style={{ color: "#4A4843" }}>
          {clock(now)} / {clock(total)}
        </span>
        <div
          role="slider"
          aria-label="Position in the recording"
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(now / 1000)}
          aria-valuetext={`${clock(now)} of ${clock(total)}`}
          tabIndex={0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * total, playing);
          }}
          onKeyDown={(e) => {
            const to = e.key === "ArrowRight" ? now + 2000 : e.key === "ArrowLeft" ? now - 2000 : e.key === "Home" ? 0 : e.key === "End" ? total : null;
            if (to === null) return;
            e.preventDefault();
            seek(to, playing);
          }}
          style={{ flex: "1 1 200px", height: 6, borderRadius: 999, background: "#EFEDE8", position: "relative", cursor: "pointer" }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "#171717", borderRadius: 999 }} />
          {failAt !== undefined && total > 0 && (
            <div title="Where it failed" style={{ position: "absolute", left: `${(failAt / total) * 100}%`, top: -3, width: 3, height: 12, background: "#C94A44", borderRadius: 2 }} />
          )}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {recordedBy}
        </span>
      </div>
    </>
  );
}
