import fc from "fast-check";
import { describe, it } from "vitest";
import type { CourseGoalDtoPayload } from "../src/api";
import {
  daysUntil,
  formatDue,
  formatHours,
  greetingForHour,
  nextOpenGoal,
  progressPercent,
  relativeDayLabel,
  serverTimeOfDay,
  upcomingOpenGoals,
} from "../src/dashboard";

const pad = (n: number): string => String(n).padStart(2, "0");
const instant = fc.integer({ min: 946_684_800_000, max: 4_102_444_800_000 });

const naive = fc
  .record({
    year: fc.integer({ min: 2000, max: 2060 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  .map((n) => `${n.year}-${pad(n.month)}-${pad(n.day)}T${pad(n.hour)}:${pad(n.minute)}:00`);

describe("dashboard formatting (property-based)", () => {
  it("greetingForHour is total and always one of the four greetings", () => {
    const greetings = new Set(["Good morning", "Good afternoon", "Good evening", "Good night"]);
    fc.assert(fc.property(fc.integer({ min: 0, max: 23 }), (hour) => greetings.has(greetingForHour(hour))));
  });

  it("formatHours never renders a negative number and has at most one decimal", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (hours) => {
        const text = formatHours(hours);
        return /^\d+(\.\d)?$/.test(text) && Number(text) >= 0;
      }),
    );
  });

  it("formatHours is within 0.05 of the (clamped) input", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 1e6, noNaN: true }), (hours) => {
        return Math.abs(Number(formatHours(hours)) - Math.max(0, hours)) <= 0.05 + 1e-9;
      }),
    );
  });

  it("progressPercent is an integer in 0..100 and never NaN, whatever the inputs", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (earned, total) => {
        const pct = progressPercent(earned, total);
        return Number.isInteger(pct) && pct >= 0 && pct <= 100;
      }),
    );
  });

  it("progressPercent is monotonic in the earned amount", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), fc.nat({ max: 1000 }), fc.integer({ min: 1, max: 1000 }), (a, b, total) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return progressPercent(lo, total) <= progressPercent(hi, total);
      }),
    );
  });

  it("formatDue is total and its wording agrees with the sign of the day count", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (n) => {
        const text = formatDue(n);
        if (n < 0) return text.endsWith("overdue") && text.startsWith(`${Math.abs(n)} day`);
        if (n === 0) return text === "today";
        return text.startsWith(`in ${n} day`);
      }),
    );
  });

  it("serverTimeOfDay reads back the HH:MM it was built from, and is empty when there is no time part", () => {
    fc.assert(
      fc.property(naive, (s) => serverTimeOfDay(s) === s.slice(11, 16)),
    );
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/T\d{2}:\d{2}/.test(s)),
        (s) => serverTimeOfDay(s) === "",
      ),
    );
  });
});

describe("dashboard dates (property-based)", () => {
  it("daysUntil shifts one-for-one with the target calendar date and is 0 for today", () => {
    fc.assert(
      fc.property(instant, fc.integer({ min: -400, max: 400 }), (now, offset) => {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(now));
        const [y, m, d] = today.split("-").map(Number) as [number, number, number];
        const target = new Date(Date.UTC(y, m - 1, d + offset));
        const targetIso = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T08:00:00`;
        return daysUntil(today, now) === 0 && daysUntil(targetIso, now) === offset;
      }),
    );
  });

  it("relativeDayLabel never throws and always returns a non-empty label", () => {
    fc.assert(fc.property(naive, instant, (s, now) => relativeDayLabel(s, now).length > 0));
  });
});

describe("course goals (property-based)", () => {
  const goal: fc.Arbitrary<CourseGoalDtoPayload> = fc.record({
    courseId: fc.nat(),
    courseName: fc.string(),
    targetDate: fc.oneof(fc.constant(null), naive),
    completedAt: fc.oneof(fc.constant(null), naive),
  });

  it("upcomingOpenGoals honours the limit, keeps only open goals with a deadline and sorts soonest first", () => {
    fc.assert(
      fc.property(fc.array(goal, { maxLength: 20 }), instant, fc.integer({ min: 0, max: 10 }), (goals, now, limit) => {
        const rows = upcomingOpenGoals(goals, now, limit);
        const open = goals.filter((g) => g.targetDate !== null && !g.completedAt).length;
        return (
          rows.length === Math.min(limit, open) &&
          rows.every((r, i) => i === 0 || (rows[i - 1] as { daysLeft: number }).daysLeft <= r.daysLeft)
        );
      }),
    );
  });

  it("nextOpenGoal is the head of the full upcoming list, or null when there is none", () => {
    fc.assert(
      fc.property(fc.array(goal, { maxLength: 20 }), instant, (goals, now) => {
        const next = nextOpenGoal(goals, now);
        const all = upcomingOpenGoals(goals, now, goals.length + 1);
        return next === null ? all.length === 0 : next.daysLeft === (all[0] as { daysLeft: number }).daysLeft;
      }),
    );
  });
});
