// Pure display logic for the new-tab dashboard - no chrome.* APIs and no DOM here, so the parts
// that are easy to get subtly wrong (day-boundary math, greeting text, hours formatting) are
// unit-testable on their own. newtab.ts wires this to the DOM and to api.ts.
import type { CourseGoalDtoPayload, NoteDtoPayload, StudySessionDtoPayload } from "./api";

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 23) return "Good evening";
  return "Good night";
}

/** "2.5" / "0" / "10" - one decimal, trimmed when it's a whole number, never negative (a
 *  server-side rounding artifact like -0.0 would otherwise render as "-0"). */
export function formatHours(hours: number): string {
  const clamped = Math.max(0, hours);
  const rounded = Math.round(clamped * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Days between a naive-local StudyLife date-time and "today", both anchored to calendar dates
 * (not wall-clock instants). StudyLife's DateTimes carry no offset and are naive Europe/Berlin
 * local time (see MetricsSummaryDto.AsOf's doc comment in the server source), so the target's
 * calendar date is read straight off its YYYY-MM-DD prefix - no reinterpretation needed. "Today"
 * is different: `nowMs` is a real instant, so it DOES need converting - explicitly to
 * Europe/Berlin, the zone the server's "today" means, not whatever zone the viewer's OS happens
 * to be set to. Ported from studylife-raycast's courseGoals.ts (same reasoning, same algorithm).
 */
export function daysUntil(targetDate: string, nowMs: number): number {
  const targetDay = Date.UTC(...dateParts(targetDate));
  const todayDay = Date.UTC(...dateParts(todayInBerlin(nowMs)));
  return Math.round((targetDay - todayDay) / 86_400_000);
}

/** "2026-09-17" - en-CA formats as YYYY-MM-DD, which is exactly the prefix dateParts expects. */
function todayInBerlin(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(nowMs));
}

function dateParts(isoLike: string): [number, number, number] {
  const [y, m, d] = isoLike.slice(0, 10).split("-").map(Number);
  return [y ?? 0, (m ?? 1) - 1, d ?? 1];
}

/** "in 3 days", "today", "2 days overdue" - same wording studylife-raycast and studylife-vscode
 *  already use for the same underlying number, so it reads consistently across the family. */
export function formatDue(daysLeft: number): string {
  if (daysLeft < 0) return `${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} overdue`;
  if (daysLeft === 0) return "today";
  return `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export interface NextGoal {
  courseId: number;
  courseName: string;
  targetDate: string;
  daysLeft: number;
  due: string;
}

/** Every open (target date set, not completed) course goal, soonest deadline first - re-derived
 *  from the raw CourseGoals.GetAll response (this extension's own scope) instead of
 *  Metrics.GetSummary's separately-cached, 5-item-capped upcomingCourseGoals, so what's shown is
 *  never behind that endpoint's 60s cache. Powers the "Course goal deadlines" panel; `limit`
 *  defaults to a handful so the panel stays a glance, not a full goal-management list. */
export function upcomingOpenGoals(goals: readonly CourseGoalDtoPayload[], nowMs: number, limit = 4): NextGoal[] {
  return goals
    .filter((g): g is CourseGoalDtoPayload & { targetDate: string } => typeof g.targetDate === "string" && !g.completedAt)
    .map((g) => {
      const daysLeft = daysUntil(g.targetDate, nowMs);
      return { courseId: g.courseId, courseName: g.courseName, targetDate: g.targetDate, daysLeft, due: formatDue(daysLeft) };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit);
}

/** The single nearest open course goal, or null if there is none - the hero tile's own reduction
 *  of upcomingOpenGoals() above (limit 1). */
export function nextOpenGoal(goals: readonly CourseGoalDtoPayload[], nowMs: number): NextGoal | null {
  return upcomingOpenGoals(goals, nowMs, 1)[0] ?? null;
}

/**
 * "14:32" read straight off a naive-local StudyLife timestamp's own digits - deliberately NOT
 * routed through `new Date(...)`, which would reinterpret an offset-less string as this browser's
 * local zone (wrong: it is Europe/Berlin, see daysUntil's doc comment above) and silently show
 * the wrong clock time on any device not itself set to Europe/Berlin. Substring extraction has no
 * zone to get wrong - the caller labels it as server time instead.
 */
export function serverTimeOfDay(isoLike: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(isoLike);
  return match ? `${match[1]}:${match[2]}` : "";
}

/**
 * "Today" / "Tomorrow" / "Yesterday" / "Fri, Sep 25" - a calendar-date-only label shared by the
 * session and note lists below. Reads the date straight off the string's own digits (via
 * daysUntil/dateParts), for the same reason daysUntil itself does: StudyLife's timestamps are
 * naive Europe/Berlin local time, and going through `new Date(isoLike)` would reinterpret them as
 * this browser's own local zone instead (see daysUntil's doc comment). The weekday/month name is
 * then read back out through a neutral UTC formatting of that same Y/M/D triple - never through
 * the original string - so no zone is ever guessed twice.
 */
export function relativeDayLabel(isoLike: string, nowMs: number): string {
  const diff = daysUntil(isoLike, nowMs);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const asUtc = new Date(Date.UTC(...dateParts(isoLike)));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(asUtc);
}

/** (EndTime - StartTime) in hours. Reading both timestamps through Date.parse is safe here even
 *  though they're naive-local (normally the wrong move, see daysUntil's doc comment): only their
 *  DIFFERENCE is used below, and whatever zone Date.parse mistakenly applies to StartTime, it
 *  applies identically to EndTime, so the misinterpreted offset cancels out exactly. */
export function sessionDurationHours(startTime: string, endTime: string): number {
  return (Date.parse(endTime) - Date.parse(startTime)) / 3_600_000;
}

/**
 * "2026-09-19T14:32:07" - the given instant reformatted into StudyLife's own naive-local
 * (Europe/Berlin) wire shape, so it can be compared lexically against raw StartTime/EndTime
 * string values directly: both are the same fixed-width, zero-padded "YYYY-MM-DDTHH:MM:SS" shape
 * in the same zone, so string order already matches chronological order - no Date parsing of the
 * (offset-less) session timestamps needed at all.
 */
function nowLocalIso(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export interface UpcomingSessionEntry {
  courseId: number;
  courseName: string;
  courseColor: string;
  topic: string | null;
  dayLabel: string;
  timeLabel: string;
}

/**
 * Sessions with a StartTime still ahead of "now" and not yet completed - StudyLife's session list
 * genuinely can hold future-dated rows: GET /api/sessions is unbounded (see
 * StudyLife.Server/Services/SessionService.cs's LoadAllAsync, "No date bounds - the client
 * fetches this once and does all week/day navigation itself"), populated either by manually
 * scheduling ahead in the calendar or by the exam planner. This is therefore real scheduled data,
 * not a synthetic "closest deadline" stand-in. `endTime > nowIso` (not startTime) is the cutoff,
 * so a session currently in progress still counts as upcoming/live rather than disappearing the
 * moment its StartTime ticks past. Sorted soonest first, capped to `limit`.
 */
export function upcomingSessions(
  sessions: readonly StudySessionDtoPayload[],
  nowMs: number,
  limit = 5,
): UpcomingSessionEntry[] {
  const nowIso = nowLocalIso(nowMs);
  return sessions
    .filter((s) => !s.isCompleted && s.endTime > nowIso)
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, limit)
    .map((s) => ({
      courseId: s.courseId,
      courseName: s.courseName,
      courseColor: s.courseColor,
      topic: s.topic,
      dayLabel: relativeDayLabel(s.startTime, nowMs),
      timeLabel: serverTimeOfDay(s.startTime),
    }));
}

export interface RecentSessionEntry {
  courseId: number;
  courseName: string;
  courseColor: string;
  dayLabel: string;
  timeLabel: string;
  hours: string;
}

/**
 * Completed sessions from the GET /api/sessions/history?onlyCompleted=true window, most recent
 * first - a genuine "what did I actually study lately" timeline, distinct in both meaning and
 * shape from upcomingSessions() above (which reads the separate, forward-looking GetAll list).
 * The `isCompleted` filter here is a defensive double-check, not a trust boundary: the server
 * already applies onlyCompleted server-side (see fetchSessionHistory), this just keeps the
 * function correct even if called with an unfiltered list (e.g. in a future test/caller).
 */
export function recentSessions(
  history: readonly StudySessionDtoPayload[],
  nowMs: number,
  limit = 6,
): RecentSessionEntry[] {
  return history
    .filter((s) => s.isCompleted)
    .slice()
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, limit)
    .map((s) => ({
      courseId: s.courseId,
      courseName: s.courseName,
      courseColor: s.courseColor,
      dayLabel: relativeDayLabel(s.startTime, nowMs),
      timeLabel: `${serverTimeOfDay(s.startTime)}–${serverTimeOfDay(s.endTime)}`,
      hours: formatHours(sessionDurationHours(s.startTime, s.endTime)),
    }));
}

export interface RecentNoteEntry {
  id: number;
  title: string;
  snippet: string;
  dayLabel: string;
}

const NOTE_SNIPPET_MAX_LENGTH = 140;

/** A short, plain-text, single-line preview: the capture-enrichment summary if there is one
 *  (already a one-sentence AI summary, see NoteDto.Summary's doc comment server-side), otherwise
 *  the note's own content with whitespace/newlines collapsed - never markdown-rendered, this
 *  stays a calm glance at a new tab, not a note reader. */
function noteSnippet(note: NoteDtoPayload): string {
  const source = note.summary?.trim() || note.content;
  const oneLine = source.replace(/\s+/g, " ").trim();
  if (oneLine.length <= NOTE_SNIPPET_MAX_LENGTH) return oneLine;
  return `${oneLine.slice(0, NOTE_SNIPPET_MAX_LENGTH - 1)}…`;
}

/** Most recently updated notes first, capped to `limit`. */
export function recentNotes(notes: readonly NoteDtoPayload[], nowMs: number, limit = 4): RecentNoteEntry[] {
  return notes
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      title: n.title.trim() || "Untitled note",
      snippet: noteSnippet(n),
      dayLabel: relativeDayLabel(n.updatedAt, nowMs),
    }));
}

/** 0-100, clamped, and 0 (not NaN/Infinity) when `total` is 0 - a programme with no creditable
 *  ECTS/topics at all is a real, if unusual, state (e.g. a freshly created empty custom
 *  programme), not an error. Shared by the ECTS and topics progress bars. */
export function progressPercent(earned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((earned / total) * 100)));
}
