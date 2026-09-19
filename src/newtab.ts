// Wires dashboard.ts's pure display logic and api.ts's fetches to the New Tab page's DOM. Fetches
// fresh on every open - there is no stale-cache display anywhere in this file: a failed or
// partial fetch always shows an explicit loading/error/degraded state instead of silently
// reusing old numbers (see README "Offline and error states").
import { fetchCourseGoals, fetchMetricsSummary, fetchTimerState, type ApiFailure, type ConnectedSettings } from "./api";
import { formatHours, greetingForHour, nextOpenGoal, serverTimeOfDay } from "./dashboard";
import { loadStoredSettings } from "./settings";

type StateName = "loading" | "notConnected" | "error" | "dashboard";

const states: Record<StateName, HTMLElement> = {
  loading: document.getElementById("state-loading") as HTMLElement,
  notConnected: document.getElementById("state-not-connected") as HTMLElement,
  error: document.getElementById("state-error") as HTMLElement,
  dashboard: document.getElementById("state-dashboard") as HTMLElement,
};

function showState(name: StateName): void {
  for (const key of Object.keys(states) as StateName[]) {
    states[key].hidden = key !== name;
  }
}

const errorMessage = document.getElementById("error-message") as HTMLElement;
const retryButton = document.getElementById("retry-button") as HTMLButtonElement;

const greetingEl = document.getElementById("greeting") as HTMLElement;
const liveBadge = document.getElementById("live-badge") as HTMLElement;
const focalNumber = document.getElementById("focal-number") as HTMLElement;
const streakValue = document.getElementById("streak-value") as HTMLElement;
const streakSub = document.getElementById("streak-sub") as HTMLElement;
const goalValue = document.getElementById("goal-value") as HTMLElement;
const goalSub = document.getElementById("goal-sub") as HTMLElement;
const asOfEl = document.getElementById("as-of") as HTMLElement;

retryButton.addEventListener("click", () => {
  void load();
});

async function load(): Promise<void> {
  showState("loading");
  const settings = await loadStoredSettings();
  if (!settings) {
    showState("notConnected");
    return;
  }
  await renderDashboard(settings);
}

async function renderDashboard(settings: ConnectedSettings): Promise<void> {
  const [summary, goals, timer] = await Promise.all([
    fetchMetricsSummary(settings),
    fetchCourseGoals(settings),
    fetchTimerState(settings),
  ]);

  // The focal number and streak both come from one call (Metrics.GetSummary) - without it there
  // is no honest dashboard to show, so this is the one failure that blocks the whole page rather
  // than degrading a single tile.
  if (!summary.ok) {
    errorMessage.textContent = describeApiFailure(summary);
    showState("error");
    return;
  }

  greetingEl.textContent = greetingForHour(new Date().getHours());
  focalNumber.textContent = formatHours(summary.data.hours.week);
  asOfEl.textContent = `Updated ${serverTimeOfDay(summary.data.asOf)} (StudyLife server time)`;

  const streak = summary.data.streak;
  if (streak.current > 0) {
    streakValue.textContent = `${streak.current}-day streak`;
    streakSub.textContent = streak.longest > streak.current ? `Best: ${streak.longest} days` : "Personal best";
  } else {
    streakValue.textContent = "No streak yet";
    streakSub.textContent = "Study today to start one";
  }

  // Course goals and the live-session badge are supplementary - a failure here degrades that one
  // tile with an explicit message instead of taking down the whole page (the hours/streak tile
  // above is still real, current data either way).
  if (goals.ok) {
    const next = nextOpenGoal(goals.data, Date.now());
    if (next) {
      goalValue.textContent = next.courseName;
      goalSub.textContent = `Goal ${next.due}`;
    } else {
      goalValue.textContent = "No upcoming goals";
      goalSub.textContent = "";
    }
  } else {
    goalValue.textContent = "Couldn't load goals";
    goalSub.textContent = describeApiFailure(goals);
  }

  liveBadge.hidden = !(timer.ok && timer.data.isRunning);

  showState("dashboard");
}

function describeApiFailure(failure: ApiFailure): string {
  switch (failure.kind) {
    case "offline":
      return "You're offline - your stats will load once you're back online.";
    case "unauthorized":
      return "StudyLife rejected the stored key - open Settings and connect again.";
    case "http":
      return `The server returned an error (HTTP ${failure.status}).`;
    case "network":
      return failure.message;
  }
}

void load();
