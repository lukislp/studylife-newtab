// Guards against StudyLife's server-side DTOs drifting out from under this extension's
// hand-mirrored payload types (src/api.ts) without anyone noticing until a build reaches users
// with the dashboard already silently broken - the server ignores unknown/misspelled field names
// instead of erroring, so a wrong field name is a green build and a tile that quietly shows
// nothing. Diffs every *_FIELDS constant in src/api.ts against the main repo's committed OpenAPI
// spec (docs/api/openapi.json) and confirms the routes this extension calls still exist. Mirrors
// studylife-focus's scripts/contract-check.mjs, generalized to this extension's four read
// endpoints (Whoami, TimerState.Get, Metrics.GetSummary, CourseGoals.GetAll) plus the generic
// dynamic-client assertion-exchange route the connect flow posts to.
import { existsSync, readFileSync } from "node:fs";

const API_TS_PATH = new URL("../src/api.ts", import.meta.url);
const DEFAULT_SPEC_SOURCE = "https://raw.githubusercontent.com/lukislp/studylife/main/docs/api/openapi.json";

// route -> { method, schema: schemaName | null }. schema: null means "just confirm the route
// exists" (used for the assertion-exchange route, whose anonymous request body has no named
// schema to diff against).
const ROUTES = [
  { path: "/api/auth/whoami", method: "get", schema: "WhoamiResponseDto", fieldsConst: "WHOAMI_FIELDS" },
  { path: "/api/timerstate", method: "get", schema: "TimerStateDto", fieldsConst: "TIMER_STATE_FIELDS" },
  { path: "/api/metrics/summary", method: "get", schema: "MetricsSummaryDto", fieldsConst: "METRICS_SUMMARY_FIELDS" },
  { path: "/api/coursegoals", method: "get", schema: "CourseGoalDto", fieldsConst: "COURSE_GOAL_FIELDS" },
  // Sessions.GetAll (unbounded list - powers the "Upcoming sessions" panel) and
  // Sessions.GetHistory (powers "Recent activity") both return the same StudySessionDto shape,
  // so they share STUDY_SESSION_FIELDS - only the route/method differ.
  { path: "/api/sessions", method: "get", schema: "StudySessionDto", fieldsConst: "STUDY_SESSION_FIELDS" },
  { path: "/api/sessions/history", method: "get", schema: "StudySessionDto", fieldsConst: "STUDY_SESSION_FIELDS" },
  { path: "/api/notes", method: "get", schema: "NoteDto", fieldsConst: "NOTE_FIELDS" },
  { path: "/api/auth/assertion-exchange", method: "post", schema: null, fieldsConst: null },
];

// Nested DTOs referenced by fields of MetricsSummaryDto above - checked against their own schema
// separately, same as the top-level ones.
const NESTED_SCHEMAS = [
  { schema: "MetricsStreakDto", fieldsConst: "METRICS_STREAK_FIELDS" },
  { schema: "MetricsHoursDto", fieldsConst: "METRICS_HOURS_FIELDS" },
  { schema: "MetricsEctsDto", fieldsConst: "METRICS_ECTS_FIELDS" },
  { schema: "MetricsTopicsDto", fieldsConst: "METRICS_TOPICS_FIELDS" },
];

async function main() {
  const specSource = process.env.STUDYLIFE_OPENAPI_SPEC || DEFAULT_SPEC_SOURCE;
  const source = readFileSync(API_TS_PATH, "utf-8");
  console.log(`Checking studylife-newtab's wire shapes against ${specSource}`);

  const spec = await loadSpec(specSource);
  const errors = [];

  for (const route of ROUTES) {
    errors.push(...checkRouteExists(spec, route));
    if (route.schema && route.fieldsConst) {
      const fields = readFieldsConst(source, route.fieldsConst);
      errors.push(...checkSchemaFieldsExist(spec, route.schema, fields));
    }
  }
  for (const { schema, fieldsConst } of NESTED_SCHEMAS) {
    const fields = readFieldsConst(source, fieldsConst);
    errors.push(...checkSchemaFieldsExist(spec, schema, fields));
  }

  if (errors.length > 0) {
    console.error("\nContract check FAILED - studylife-newtab's wire shapes have drifted from the API spec:\n");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(`\nSource of truth: ${specSource}`);
    process.exit(1);
  }

  console.log(`Contract check passed: ${ROUTES.length} route(s) and every declared field all match the spec.`);
}

// Parses `export const NAME = [...] as const satisfies ...;` out of src/api.ts's source text.
// Deliberately a plain regex, not a TS parser, to keep this script dependency-free.
function readFieldsConst(source, constName) {
  const pattern = new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const match = source.match(pattern);
  if (!match) {
    console.error(`Could not find ${constName} in ${API_TS_PATH.pathname}`);
    process.exit(1);
  }
  const fields = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (fields.length === 0) {
    console.error(`Found ${constName} in ${API_TS_PATH.pathname} but parsed zero field names out of it.`);
    process.exit(1);
  }
  return fields;
}

// `source` is a file path (resolved relative to the current working directory, i.e. the repo
// root when run via `npm run contract-check`) unless it looks like a URL.
async function loadSpec(source) {
  const isUrl = /^https?:\/\//i.test(source);
  let text;
  try {
    if (isUrl) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      text = await response.text();
    } else {
      if (!existsSync(source)) {
        throw new Error("file not found");
      }
      text = readFileSync(source, "utf-8");
    }
  } catch (error) {
    console.error(`Could not load the OpenAPI spec from ${source}: ${error.message}`);
    process.exit(1);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`OpenAPI spec at ${source} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

function checkRouteExists(spec, route) {
  const pathItem = spec?.paths?.[route.path];
  if (!pathItem) {
    return [`Spec has no "${route.path}" path at all (expected ${route.method.toUpperCase()}).`];
  }
  if (!pathItem[route.method]) {
    return [`Spec is missing ${route.method.toUpperCase()} ${route.path}.`];
  }
  return [];
}

function checkSchemaFieldsExist(spec, schemaName, fields) {
  const schema = findSchema(spec, schemaName);
  if (!schema) {
    return [`Spec has no "${schemaName}" component schema (checked components.schemas for an exact or suffix match).`];
  }
  const specFields = new Set(Object.keys(schema.properties ?? {}));
  const errors = [];
  for (const field of fields) {
    if (!specFields.has(field)) {
      errors.push(`${schemaName} field "${field}" is read by src/api.ts but the spec's ${schemaName} schema has no such property (drift or rename?).`);
    }
  }
  return errors;
}

// The schema key may be the bare name or a fully-qualified one like "StudyLifeSharedDtosFooDto"
// depending on how the generator names components - try an exact match first, then fall back to
// any key ending in the bare name.
function findSchema(spec, schemaName) {
  const schemas = spec?.components?.schemas;
  if (!schemas) return undefined;
  if (schemas[schemaName]) return schemas[schemaName];
  const suffixKey = Object.keys(schemas).find((key) => key !== schemaName && key.endsWith(schemaName));
  return suffixKey ? schemas[suffixKey] : undefined;
}

main().catch((error) => {
  console.error("Contract check crashed unexpectedly:", error);
  process.exit(1);
});
