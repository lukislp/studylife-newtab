// Wires dashboard.ts's pure display logic and api.ts's fetches to the New Tab page's DOM. Fetches
// fresh on every open - there is no stale-cache display anywhere in this file: a failed or
// partial fetch always shows an explicit loading/error/degraded state instead of silently
// reusing old numbers (see README "Offline and error states").
import {
  fetchCourseGoals,
  fetchMetricsSummary,
  fetchNotes,
  fetchSessionHistory,
  fetchSessions,
  fetchTimerState,
  type ApiFailure,
  type ApiResult,
  type ConnectedSettings,
  type CourseGoalDtoPayload,
  type MetricsSummaryDtoPayload,
  type NoteDtoPayload,
  type StudySessionDtoPayload,
} from "./api";
import {
  formatHours,
  greetingForHour,
  nextOpenGoal,
  progressPercent,
  recentNotes,
  recentSessions,
  serverTimeOfDay,
  upcomingOpenGoals,
  upcomingSessions,
} from "./dashboard";
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

const upcomingList = document.getElementById("upcoming-list") as HTMLUListElement;
const upcomingEmpty = document.getElementById("upcoming-empty") as HTMLElement;
const upcomingError = document.getElementById("upcoming-error") as HTMLElement;

const recentList = document.getElementById("recent-list") as HTMLUListElement;
const recentEmpty = document.getElementById("recent-empty") as HTMLElement;
const recentError = document.getElementById("recent-error") as HTMLElement;

const goalsList = document.getElementById("goals-list") as HTMLUListElement;
const goalsEmpty = document.getElementById("goals-empty") as HTMLElement;
const goalsError = document.getElementById("goals-error") as HTMLElement;

const progressBody = document.getElementById("progress-body") as HTMLElement;

const notesList = document.getElementById("notes-list") as HTMLUListElement;
const notesEmpty = document.getElementById("notes-empty") as HTMLElement;
const notesError = document.getElementById("notes-error") as HTMLElement;

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
  const [summary, goals, timer, upcoming, recent, notes] = await Promise.all([
    fetchMetricsSummary(settings),
    fetchCourseGoals(settings),
    fetchTimerState(settings),
    fetchSessions(settings),
    fetchSessionHistory(settings),
    fetchNotes(settings),
  ]);

  // The focal number and streak both come from one call (Metrics.GetSummary) - without it there
  // is no honest dashboard to show, so this is the one failure that blocks the whole page rather
  // than degrading a single panel.
  if (!summary.ok) {
    errorMessage.textContent = describeApiFailure(summary);
    showState("error");
    return;
  }

  const now = Date.now();

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

  // Every panel below is supplementary - a failure in any one of them degrades that single panel
  // with its own explicit "couldn't load" message instead of taking down the whole page for data
  // it didn't actually need (same contract as the pre-existing goal tile).
  renderGoalHero(goals, now);
  renderUpcomingPanel(upcoming, now);
  renderRecentPanel(recent, now);
  renderGoalsPanel(goals, now);
  renderProgressPanel(summary.data);
  renderNotesPanel(notes, now);

  liveBadge.hidden = !(timer.ok && timer.data.isRunning);

  showState("dashboard");
}

function renderGoalHero(result: ApiResult<{ data: CourseGoalDtoPayload[] }>, now: number): void {
  if (result.ok) {
    const next = nextOpenGoal(result.data, now);
    if (next) {
      goalValue.textContent = next.courseName;
      goalSub.textContent = `Goal ${next.due}`;
    } else {
      goalValue.textContent = "No upcoming goals";
      goalSub.textContent = "";
    }
  } else {
    goalValue.textContent = "Couldn't load goals";
    goalSub.textContent = describeApiFailure(result);
  }
}

function renderUpcomingPanel(result: ApiResult<{ data: StudySessionDtoPayload[] }>, now: number): void {
  if (!result.ok) {
    showPanelError(upcomingList, upcomingEmpty, upcomingError, describeApiFailure(result));
    return;
  }
  upcomingError.hidden = true;
  const entries = upcomingSessions(result.data, now);
  renderEntries(upcomingList, upcomingEmpty, entries, (e) => ({
    color: e.courseColor,
    title: e.topic ? `${e.courseName} · ${e.topic}` : e.courseName,
    sub: `${e.dayLabel} · ${e.timeLabel}`,
  }));
}

function renderRecentPanel(result: ApiResult<{ data: StudySessionDtoPayload[] }>, now: number): void {
  if (!result.ok) {
    showPanelError(recentList, recentEmpty, recentError, describeApiFailure(result));
    return;
  }
  recentError.hidden = true;
  const entries = recentSessions(result.data, now);
  renderEntries(recentList, recentEmpty, entries, (e) => ({
    color: e.courseColor,
    title: e.courseName,
    sub: `${e.dayLabel} · ${e.timeLabel} · ${e.hours}h`,
  }));
}

function renderGoalsPanel(result: ApiResult<{ data: CourseGoalDtoPayload[] }>, now: number): void {
  if (!result.ok) {
    showPanelError(goalsList, goalsEmpty, goalsError, describeApiFailure(result));
    return;
  }
  goalsError.hidden = true;
  const entries = upcomingOpenGoals(result.data, now);
  renderEntries(goalsList, goalsEmpty, entries, (g) => ({
    title: g.courseName,
    sub: `Due ${g.due}`,
  }));
}

function renderNotesPanel(result: ApiResult<{ data: NoteDtoPayload[] }>, now: number): void {
  if (!result.ok) {
    showPanelError(notesList, notesEmpty, notesError, describeApiFailure(result));
    return;
  }
  notesError.hidden = true;
  const entries = recentNotes(result.data, now);
  renderEntries(notesList, notesEmpty, entries, (n) => ({
    title: n.title,
    sub: `${n.snippet} — ${n.dayLabel}`,
  }));
}

function renderProgressPanel(data: MetricsSummaryDtoPayload): void {
  progressBody.replaceChildren(
    progressRow("ECTS earned", data.ects.earned, data.ects.total, "ECTS"),
    progressRow("Topics completed", data.topics.completed, data.topics.total, "topics"),
  );
  if (data.averageGrade != null) {
    const gradeLine = document.createElement("p");
    gradeLine.className = "progress-grade";
    gradeLine.textContent = `Average grade: ${data.averageGrade.toFixed(1)}`;
    progressBody.appendChild(gradeLine);
  }
}

function progressRow(label: string, earned: number, total: number, unit: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "progress-row";

  const head = document.createElement("div");
  head.className = "progress-row-head";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.textContent = total > 0 ? `${earned} / ${total} ${unit}` : "Not tracked";
  head.append(labelEl, valueEl);

  const bar = document.createElement("div");
  bar.className = "progress-bar";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  fill.style.width = `${progressPercent(earned, total)}%`;
  bar.appendChild(fill);

  row.append(head, bar);
  return row;
}

// Shared list renderer for the upcoming/recent/goals/notes panels - all four are "a short list of
// (optionally colored) title+subtitle rows, or an empty-state hint". Builds nodes via
// createElement/textContent only (never innerHTML with fetched data), so a course/note title or
// topic that happens to contain markup is rendered as inert text, not parsed.
function renderEntries<T>(
  listEl: HTMLElement,
  emptyEl: HTMLElement,
  items: readonly T[],
  toEntry: (item: T) => { color?: string; title: string; sub: string },
): void {
  listEl.replaceChildren();
  if (items.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  for (const item of items) {
    listEl.appendChild(entryItem(toEntry(item)));
  }
}

function entryItem(entry: { color?: string; title: string; sub: string }): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "entry";

  if (entry.color) {
    const dot = document.createElement("span");
    dot.className = "entry-dot";
    dot.style.background = entry.color;
    dot.setAttribute("aria-hidden", "true");
    li.appendChild(dot);
  }

  const body = document.createElement("div");
  body.className = "entry-body";
  const titleEl = document.createElement("div");
  titleEl.className = "entry-title";
  titleEl.textContent = entry.title;
  const subEl = document.createElement("div");
  subEl.className = "entry-sub";
  subEl.textContent = entry.sub;
  body.append(titleEl, subEl);
  li.appendChild(body);

  return li;
}

function showPanelError(listEl: HTMLElement, emptyEl: HTMLElement, errorEl: HTMLElement, message: string): void {
  listEl.replaceChildren();
  emptyEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
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
