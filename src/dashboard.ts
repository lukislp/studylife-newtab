// Pure display logic for the new-tab dashboard - no chrome.* APIs and no DOM here, so the parts
// that are easy to get subtly wrong (day-boundary math, greeting text, hours formatting) are
// unit-testable on their own. newtab.ts wires this to the DOM and to api.ts.
import type { CourseGoalDtoPayload } from "./api";

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

/** The single nearest open (target date set, not completed) course goal, or null if there is
 *  none - re-derived from the raw CourseGoals.GetAll response (this extension's own scope)
 *  instead of Metrics.GetSummary's separately-cached, 5-item-capped upcomingCourseGoals, so the
 *  deadline shown is never behind that endpoint's 60s cache. */
export function nextOpenGoal(goals: readonly CourseGoalDtoPayload[], nowMs: number): NextGoal | null {
  const open = goals
    .filter((g): g is CourseGoalDtoPayload & { targetDate: string } => typeof g.targetDate === "string" && !g.completedAt)
    .map((g) => {
      const daysLeft = daysUntil(g.targetDate, nowMs);
      return { courseId: g.courseId, courseName: g.courseName, targetDate: g.targetDate, daysLeft, due: formatDue(daysLeft) };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return open[0] ?? null;
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
