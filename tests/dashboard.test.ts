import { describe, expect, it } from "vitest";
import { daysUntil, formatDue, formatHours, greetingForHour, nextOpenGoal, serverTimeOfDay } from "../src/dashboard";
import type { CourseGoalDtoPayload } from "../src/api";

describe("greetingForHour", () => {
  it("returns a morning greeting for 5-11", () => {
    expect(greetingForHour(5)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
  });

  it("returns an afternoon greeting for 12-17", () => {
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(17)).toBe("Good afternoon");
  });

  it("returns an evening greeting for 18-22", () => {
    expect(greetingForHour(18)).toBe("Good evening");
    expect(greetingForHour(22)).toBe("Good evening");
  });

  it("returns a night greeting for 23-4, wrapping past midnight", () => {
    expect(greetingForHour(23)).toBe("Good night");
    expect(greetingForHour(0)).toBe("Good night");
    expect(greetingForHour(4)).toBe("Good night");
  });
});

describe("formatHours", () => {
  it("formats a whole number without a decimal", () => {
    expect(formatHours(3)).toBe("3");
    expect(formatHours(0)).toBe("0");
  });

  it("formats a fractional value to one decimal", () => {
    expect(formatHours(2.5)).toBe("2.5");
    expect(formatHours(2.34)).toBe("2.3");
    expect(formatHours(2.36)).toBe("2.4");
  });

  it("clamps a negative value (rounding artifact) to zero", () => {
    expect(formatHours(-0.001)).toBe("0");
  });
});

describe("daysUntil", () => {
  // 2026-09-19 12:00 UTC is 2026-09-19 in Europe/Berlin (CEST, UTC+2) as well as in most other
  // zones - picking a midday instant keeps this test independent of the runner's own TZ env var.
  const noonSept19 = Date.UTC(2026, 8, 19, 12, 0, 0);

  it("returns 0 for a target date that is today", () => {
    expect(daysUntil("2026-09-19T00:00:00", noonSept19)).toBe(0);
  });

  it("returns a positive number of days for a future target date", () => {
    expect(daysUntil("2026-09-22T00:00:00", noonSept19)).toBe(3);
  });

  it("returns a negative number of days for a past (overdue) target date", () => {
    expect(daysUntil("2026-09-17T00:00:00", noonSept19)).toBe(-2);
  });

  it("ignores the target's time-of-day - only the calendar date matters", () => {
    expect(daysUntil("2026-09-22T23:59:59", noonSept19)).toBe(3);
  });
});

describe("formatDue", () => {
  it("formats today", () => {
    expect(formatDue(0)).toBe("today");
  });

  it("formats a future day count, singular and plural", () => {
    expect(formatDue(1)).toBe("in 1 day");
    expect(formatDue(5)).toBe("in 5 days");
  });

  it("formats an overdue day count, singular and plural", () => {
    expect(formatDue(-1)).toBe("1 day overdue");
    expect(formatDue(-5)).toBe("5 days overdue");
  });
});

describe("serverTimeOfDay", () => {
  it("reads HH:MM straight off a naive-local timestamp without any Date reinterpretation", () => {
    expect(serverTimeOfDay("2026-09-19T14:32:07")).toBe("14:32");
  });

  it("returns an empty string for a value with no time component", () => {
    expect(serverTimeOfDay("2026-09-19")).toBe("");
  });
});

describe("nextOpenGoal", () => {
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);

  function goal(overrides: Partial<CourseGoalDtoPayload>): CourseGoalDtoPayload {
    return {
      courseId: 1,
      courseName: "Course",
      targetDate: null,
      completedAt: null,
      ...overrides,
    };
  }

  it("returns null when there are no goals", () => {
    expect(nextOpenGoal([], now)).toBeNull();
  });

  it("returns null when every goal is completed", () => {
    const goals = [goal({ targetDate: "2026-09-20T00:00:00", completedAt: "2026-09-18T00:00:00" })];
    expect(nextOpenGoal(goals, now)).toBeNull();
  });

  it("returns null when every goal has no target date", () => {
    expect(nextOpenGoal([goal({ targetDate: null })], now)).toBeNull();
  });

  it("picks the soonest open goal among several", () => {
    const goals = [
      goal({ courseId: 1, courseName: "Later", targetDate: "2026-10-01T00:00:00" }),
      goal({ courseId: 2, courseName: "Soonest", targetDate: "2026-09-21T00:00:00" }),
      goal({ courseId: 3, courseName: "Completed, ignored", targetDate: "2026-09-20T00:00:00", completedAt: "2026-09-01T00:00:00" }),
    ];
    const result = nextOpenGoal(goals, now);
    expect(result?.courseName).toBe("Soonest");
    expect(result?.daysLeft).toBe(2);
    expect(result?.due).toBe("in 2 days");
  });

  it("surfaces an overdue goal as the nearest one when it's the only open goal", () => {
    const goals = [goal({ targetDate: "2026-09-10T00:00:00" })];
    const result = nextOpenGoal(goals, now);
    expect(result?.daysLeft).toBe(-9);
    expect(result?.due).toBe("9 days overdue");
  });
});
