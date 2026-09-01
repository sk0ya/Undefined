import type { Phase, TimerState } from "../types";

export const TIMER_PRESETS = [5, 10, 15, 20];

const RECOMMENDED_MINUTES: Partial<Record<Phase, number>> = {
  briefing: 5,
  discussion: 15,
  voting: 10,
  finalize: 10,
};

export type TimerMode = "idle" | "running" | "paused" | "over";

export function phaseTimerPreset(phase: Phase): number {
  return RECOMMENDED_MINUTES[phase] ?? 10;
}

export function timerMode(timer: TimerState, nowMs: number): TimerMode {
  if (timer.running) return timer.endsAtMs <= nowMs ? "over" : "running";
  if (timer.remainingMs > 0) return "paused";
  return "idle";
}
