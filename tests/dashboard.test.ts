import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatDue,
  formatHours,
  greetingForHour,
  nextOpenGoal,
  progressPercent,
  recentNotes,
  recentSessions,
  relativeDayLabel,
  serverTimeOfDay,
  sessionDurationHours,
  upcomingOpenGoals,
  upcomingSessions,
} from "../src/dashboard";
import type { CourseGoalDtoPayload, NoteDtoPayload, StudySessionDtoPayload } from "../src/api";

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

describe("upcomingOpenGoals", () => {
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);

  function goal(overrides: Partial<CourseGoalDtoPayload>): CourseGoalDtoPayload {
    return { courseId: 1, courseName: "Course", targetDate: null, completedAt: null, ...overrides };
  }

  it("returns every open goal, soonest deadline first", () => {
    const goals = [
      goal({ courseId: 1, courseName: "Later", targetDate: "2026-10-01T00:00:00" }),
      goal({ courseId: 2, courseName: "Soonest", targetDate: "2026-09-21T00:00:00" }),
      goal({ courseId: 3, courseName: "Middle", targetDate: "2026-09-25T00:00:00" }),
    ];
    const result = upcomingOpenGoals(goals, now, 10);
    expect(result.map((g) => g.courseName)).toEqual(["Soonest", "Middle", "Later"]);
  });

  it("excludes completed goals and goals without a target date", () => {
    const goals = [
      goal({ courseName: "Completed", targetDate: "2026-09-20T00:00:00", completedAt: "2026-09-18T00:00:00" }),
      goal({ courseName: "No date", targetDate: null }),
    ];
    expect(upcomingOpenGoals(goals, now, 10)).toEqual([]);
  });

  it("respects the limit", () => {
    const goals = [1, 2, 3, 4, 5].map((n) => goal({ courseId: n, courseName: `Goal ${n}`, targetDate: `2026-09-${20 + n}T00:00:00` }));
    expect(upcomingOpenGoals(goals, now, 2)).toHaveLength(2);
  });
});

describe("relativeDayLabel", () => {
  // Same anchor as daysUntil's own tests: 2026-09-19 12:00 UTC is 2026-09-19 14:00 in
  // Europe/Berlin (CEST, UTC+2).
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);

  it("labels today, tomorrow and yesterday specially", () => {
    expect(relativeDayLabel("2026-09-19T09:00:00", now)).toBe("Today");
    expect(relativeDayLabel("2026-09-20T09:00:00", now)).toBe("Tomorrow");
    expect(relativeDayLabel("2026-09-18T09:00:00", now)).toBe("Yesterday");
  });

  it("formats any other date as a short weekday + month + day", () => {
    expect(relativeDayLabel("2026-09-25T09:00:00", now)).toBe("Fri, Sep 25");
  });

  it("crosses a month boundary correctly", () => {
    expect(relativeDayLabel("2026-10-02T09:00:00", now)).toBe("Fri, Oct 2");
  });
});

describe("sessionDurationHours", () => {
  it("computes the difference in hours", () => {
    expect(sessionDurationHours("2026-09-19T14:00:00", "2026-09-19T16:00:00")).toBe(2);
  });

  it("handles a fractional duration", () => {
    expect(sessionDurationHours("2026-09-19T14:00:00", "2026-09-19T15:30:00")).toBe(1.5);
  });
});

describe("upcomingSessions", () => {
  // Berlin local "now" is 2026-09-19T14:00:00 (see relativeDayLabel's tests above).
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);

  function session(overrides: Partial<StudySessionDtoPayload>): StudySessionDtoPayload {
    return {
      courseId: 1,
      courseName: "Course",
      courseColor: "#6C5CE7",
      startTime: "2026-09-20T10:00:00",
      endTime: "2026-09-20T11:00:00",
      topic: null,
      isCompleted: false,
      ...overrides,
    };
  }

  it("returns future, not-yet-completed sessions sorted soonest first", () => {
    const sessions = [
      session({ courseId: 1, courseName: "Later", startTime: "2026-09-25T09:00:00", endTime: "2026-09-25T10:00:00" }),
      session({ courseId: 2, courseName: "Soonest", startTime: "2026-09-20T08:00:00", endTime: "2026-09-20T09:00:00" }),
    ];
    const result = upcomingSessions(sessions, now, 10);
    expect(result.map((s) => s.courseName)).toEqual(["Soonest", "Later"]);
  });

  it("keeps a session that's currently in progress (started before now, ends after)", () => {
    const inProgress = session({ courseName: "Live now", startTime: "2026-09-19T13:30:00", endTime: "2026-09-19T14:30:00" });
    const result = upcomingSessions([inProgress], now, 10);
    expect(result.map((s) => s.courseName)).toEqual(["Live now"]);
  });

  it("excludes sessions that already ended", () => {
    const past = session({ startTime: "2026-09-19T10:00:00", endTime: "2026-09-19T11:00:00" });
    expect(upcomingSessions([past], now, 10)).toEqual([]);
  });

  it("excludes completed sessions even if their time is in the future (e.g. logged ahead)", () => {
    const completed = session({ startTime: "2026-09-25T10:00:00", endTime: "2026-09-25T11:00:00", isCompleted: true });
    expect(upcomingSessions([completed], now, 10)).toEqual([]);
  });

  it("carries the topic through when set", () => {
    const withTopic = session({ topic: "Chapter 3" });
    expect(upcomingSessions([withTopic], now, 10)[0]?.topic).toBe("Chapter 3");
  });

  it("respects the limit", () => {
    const sessions = [1, 2, 3, 4].map((n) =>
      session({ courseId: n, startTime: `2026-09-2${n}T09:00:00`, endTime: `2026-09-2${n}T10:00:00` }),
    );
    expect(upcomingSessions(sessions, now, 2)).toHaveLength(2);
  });
});

describe("recentSessions", () => {
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);

  function session(overrides: Partial<StudySessionDtoPayload>): StudySessionDtoPayload {
    return {
      courseId: 1,
      courseName: "Course",
      courseColor: "#6C5CE7",
      startTime: "2026-09-17T10:00:00",
      endTime: "2026-09-17T12:00:00",
      topic: null,
      isCompleted: true,
      ...overrides,
    };
  }

  it("returns completed sessions sorted most recent first", () => {
    const sessions = [
      session({ courseId: 1, courseName: "Older", startTime: "2026-09-15T10:00:00", endTime: "2026-09-15T11:00:00" }),
      session({ courseId: 2, courseName: "Newer", startTime: "2026-09-18T10:00:00", endTime: "2026-09-18T11:00:00" }),
    ];
    const result = recentSessions(sessions, now, 10);
    expect(result.map((s) => s.courseName)).toEqual(["Newer", "Older"]);
  });

  it("excludes not-yet-completed sessions", () => {
    const notCompleted = session({ isCompleted: false });
    expect(recentSessions([notCompleted], now, 10)).toEqual([]);
  });

  it("formats the duration and a Today/weekday label", () => {
    const today = session({ startTime: "2026-09-19T09:00:00", endTime: "2026-09-19T10:30:00" });
    const result = recentSessions([today], now, 10);
    expect(result[0]?.dayLabel).toBe("Today");
    expect(result[0]?.hours).toBe("1.5");
    expect(result[0]?.timeLabel).toBe("09:00–10:30");
  });

  it("respects the limit", () => {
    const sessions = [1, 2, 3].map((n) => session({ courseId: n, startTime: `2026-09-1${n}T10:00:00`, endTime: `2026-09-1${n}T11:00:00` }));
    expect(recentSessions(sessions, now, 1)).toHaveLength(1);
  });
});

describe("recentNotes", () => {
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);

  function note(overrides: Partial<NoteDtoPayload>): NoteDtoPayload {
    return { id: 1, title: "Note", content: "Some content here.", updatedAt: "2026-09-17T10:00:00", summary: null, ...overrides };
  }

  it("returns notes sorted by most recently updated first", () => {
    const notes = [
      note({ id: 1, title: "Older", updatedAt: "2026-09-10T10:00:00" }),
      note({ id: 2, title: "Newer", updatedAt: "2026-09-18T10:00:00" }),
    ];
    expect(recentNotes(notes, now, 10).map((n) => n.title)).toEqual(["Newer", "Older"]);
  });

  it("prefers the capture-enrichment summary over raw content when present", () => {
    const withSummary = note({ content: "Long raw content that should not be used.", summary: "A short AI summary." });
    expect(recentNotes([withSummary], now, 10)[0]?.snippet).toBe("A short AI summary.");
  });

  it("falls back to content, collapsing whitespace/newlines into a single line", () => {
    const withoutSummary = note({ content: "Line one\n\nLine   two", summary: null });
    expect(recentNotes([withoutSummary], now, 10)[0]?.snippet).toBe("Line one Line two");
  });

  it("truncates a long snippet with an ellipsis", () => {
    const long = note({ content: "x".repeat(200), summary: null });
    const snippet = recentNotes([long], now, 10)[0]?.snippet ?? "";
    expect(snippet.length).toBe(140);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("falls back to 'Untitled note' for a blank title", () => {
    const blank = note({ title: "   " });
    expect(recentNotes([blank], now, 10)[0]?.title).toBe("Untitled note");
  });

  it("respects the limit", () => {
    const notes = [1, 2, 3].map((n) => note({ id: n, updatedAt: `2026-09-1${n}T10:00:00` }));
    expect(recentNotes(notes, now, 1)).toHaveLength(1);
  });
});

describe("progressPercent", () => {
  it("computes a rounded percentage", () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
  });

  it("returns 0 (not NaN/Infinity) when total is 0", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5, 0)).toBe(0);
  });

  it("clamps to 100 even if earned somehow exceeds total", () => {
    expect(progressPercent(10, 5)).toBe(100);
  });
});
