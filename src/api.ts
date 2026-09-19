// Wire shapes mirrored from StudyLife.Shared/Dtos.cs (read in full before writing this file, per
// this project's "verify the real DTO, don't guess field names" rule - a wrong field name here
// would be silently ignored by both TypeScript's structural typing and the server's own lenient
// JSON binder, producing a green build and a tile that quietly shows nothing). Only the fields
// this extension actually reads are declared, same convention as studylife-focus's api.ts -
// scripts/contract-check.mjs diffs the *_FIELDS constants below against the committed OpenAPI
// spec so a server-side rename fails CI here instead of silently breaking the dashboard once a
// build reaches users.
//
// Read-only surface only (Whoami, TimerState.Get, Metrics.GetSummary, CourseGoals.GetAll) - this
// is a dashboard, not a control surface, so there is deliberately no write call here.
import { normalizeServerUrl } from "./settings";

// ── GET /api/auth/whoami (WhoamiResponseDto) - used to validate a freshly connected API key and
// to power the "connected as" confirmation on the options page. ──
export interface WhoamiResponseDtoPayload {
  userId: number;
  credential: string;
}
export const WHOAMI_FIELDS = ["userId", "credential"] as const satisfies readonly (keyof WhoamiResponseDtoPayload)[];

// ── GET /api/timerstate (TimerStateDto) - only the "is a session running right now, and when
// does this phase end" fields, same subset studylife-focus's Guard/Tune features read. ──
export interface TimerStateDtoPayload {
  isRunning: boolean;
  isBreak: boolean;
  phaseEndsAt: string | null;
  serverNow: string;
}
export const TIMER_STATE_FIELDS = [
  "isRunning",
  "isBreak",
  "phaseEndsAt",
  "serverNow",
] as const satisfies readonly (keyof TimerStateDtoPayload)[];

// ── GET /api/metrics/summary (MetricsSummaryDto) - trimmed to the streak and this-week hours
// tiles. There is no server-side "today's hours" field in MetricsSummaryDto (Hours only carries
// Week/Month/Total, see StudyLife.Shared/Dtos.cs) - the dashboard's focal number is "hours this
// week" instead, which is what this endpoint actually, honestly provides. ──
export interface MetricsStreakDtoPayload {
  current: number;
  longest: number;
}
export interface MetricsHoursDtoPayload {
  week: number;
}
export interface MetricsSummaryDtoPayload {
  asOf: string;
  streak: MetricsStreakDtoPayload;
  hours: MetricsHoursDtoPayload;
}
export const METRICS_SUMMARY_FIELDS = ["asOf", "streak", "hours"] as const satisfies readonly (keyof MetricsSummaryDtoPayload)[];
export const METRICS_STREAK_FIELDS = ["current", "longest"] as const satisfies readonly (keyof MetricsStreakDtoPayload)[];
export const METRICS_HOURS_FIELDS = ["week"] as const satisfies readonly (keyof MetricsHoursDtoPayload)[];

// ── GET /api/coursegoals (CourseGoalDto[]) - the full list, so the dashboard can find the
// nearest open deadline itself rather than relying on metrics/summary's separately-cached,
// 5-item-capped upcomingCourseGoals projection. Mirrors studylife-raycast's courseGoals.ts. ──
export interface CourseGoalDtoPayload {
  courseId: number;
  courseName: string;
  targetDate: string | null;
  completedAt: string | null;
}
export const COURSE_GOAL_FIELDS = [
  "courseId",
  "courseName",
  "targetDate",
  "completedAt",
] as const satisfies readonly (keyof CourseGoalDtoPayload)[];

// A network round trip that hangs forever (unreachable server, no TCP reset) would otherwise
// leave the new tab page stuck on its loading state indefinitely.
const REQUEST_TIMEOUT_MS = 10_000;

export type ApiFailure =
  | { ok: false; kind: "offline" }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "http"; status: number }
  | { ok: false; kind: "network"; message: string };

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

export interface ConnectedSettings {
  serverUrl: string;
  apiKey: string;
}

async function getJson<T>(settings: ConnectedSettings, path: string): Promise<ApiResult<{ data: T }>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline" };
  }
  const url = `${normalizeServerUrl(settings.serverUrl)}${path}`;
  try {
    const response = await fetchWithTimeout(url, { headers: { "X-Api-Key": settings.apiKey } });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, kind: "unauthorized" };
    }
    if (!response.ok) {
      return { ok: false, kind: "http", status: response.status };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    return { ok: false, kind: "network", message: describeError(error) };
  }
}

export function fetchWhoami(settings: ConnectedSettings): Promise<ApiResult<{ data: WhoamiResponseDtoPayload }>> {
  return getJson<WhoamiResponseDtoPayload>(settings, "/api/auth/whoami");
}

export function fetchTimerState(settings: ConnectedSettings): Promise<ApiResult<{ data: TimerStateDtoPayload }>> {
  return getJson<TimerStateDtoPayload>(settings, "/api/timerstate");
}

export function fetchMetricsSummary(settings: ConnectedSettings): Promise<ApiResult<{ data: MetricsSummaryDtoPayload }>> {
  return getJson<MetricsSummaryDtoPayload>(settings, "/api/metrics/summary");
}

export function fetchCourseGoals(settings: ConnectedSettings): Promise<ApiResult<{ data: CourseGoalDtoPayload[] }>> {
  return getJson<CourseGoalDtoPayload[]>(settings, "/api/coursegoals");
}

export type ExchangeResult =
  | { ok: true; apiKey: string }
  | { ok: false; kind: "offline" }
  // The server predates the generic dynamic-client connect endpoint - callers should tell the
  // user to update their server instead of retrying.
  | { ok: false; kind: "not-found" }
  | { ok: false; kind: "http"; status: number; message: string }
  | { ok: false; kind: "network"; message: string };

// Trades the passkey-signed assertion from the browser consent flow
// (chrome.identity.launchWebAuthFlow, see connect.ts/background.ts) for this client's API key -
// the server-side counterpart is POST /api/auth/assertion-exchange (StudyLife's AuthController,
// generic dynamic-client flow). Anonymous POST: the assertion itself is the one-time credential,
// there's no X-Api-Key to send yet since that's exactly what this call is meant to produce.
export async function exchangeAssertion(
  serverUrl: string,
  clientId: string,
  assertion: string,
  codeVerifier: string,
): Promise<ExchangeResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline" };
  }
  const url = `${normalizeServerUrl(serverUrl)}/api/auth/assertion-exchange`;
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, assertion, codeVerifier }),
    });
    if (response.status === 404) {
      return { ok: false, kind: "not-found" };
    }
    if (!response.ok) {
      return { ok: false, kind: "http", status: response.status, message: await safeText(response) };
    }
    const body = (await response.json()) as { apiKey?: string };
    if (!body.apiKey) {
      return { ok: false, kind: "http", status: response.status, message: "Server response was missing apiKey." };
    }
    return { ok: true, apiKey: body.apiKey };
  } catch (error) {
    return { ok: false, kind: "network", message: describeError(error) };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request timed out.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}
