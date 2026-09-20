#!/usr/bin/env node
'use strict';
/*=============================================================================
 * H3 Protocol — in-process schema / example validator (STEP 1 + STEP 2 + STEP 4)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `tests/validate-schemas.sh` used to run one `ajv` CLI process per assertion.
 * The `ajv` CLI is a Node script, so every assertion paid a full Node
 * interpreter start (~33 interpreter starts per gate run) for a check whose
 * subject is "does this schema compile / does this payload validate" — the
 * process boundary was never the thing under test, and on a shared box those
 * short-lived interpreters are pure load.
 *
 * This runner performs the same checks in ONE interpreter:
 *   STEP 1 — compile every schema (standalone, and with its `-r` dependencies)
 *   STEP 2 — validate every example payload against its schema
 *   STEP 4 — prove every file in schemas/v1/ is covered by STEP 1 (anti-rot)
 * and prints one line per check back into the shell script's counters, so the
 * gate's check count and PASS/FAIL contract are unchanged. Two real `ajv` CLI
 * invocations (the parity smokes in validate-schemas.sh) keep the CLI path
 * itself covered.
 *
 * PARITY
 * ------
 * The Ajv instance is built by ajv-cli's OWN factory module
 * (`ajv-cli/dist/commands/ajv.js`) with the same argv the shell used to pass —
 * `--spec=draft2020 --strict=false --all-errors`. Option parsing, Ajv class
 * selection and draft-06 meta-schema registration are therefore the CLI's code,
 * not a re-implementation of it; a hand-rolled `new Ajv2020({...})` would be a
 * different thing that merely looks similar. Each check still gets a FRESH Ajv
 * instance, exactly as a fresh CLI process did (schema registration cannot leak
 * between checks), except that a compiled schema is reused for read-only
 * re-validation of further payloads (the 6 decision examples share one compile
 * of the decision union — the same "one shared build for read-only consumers"
 * shape; validation results are unaffected).
 *
 * No caching across runs, no skips, no reduced strictness: every run compiles
 * and validates everything from disk.
 *
 * OUTPUT PROTOCOL (consumed by tests/validate-schemas.sh)
 * ------------------------------------------------------
 *   INFO<TAB><step><TAB><text>
 *   CHECK<TAB><step><TAB>PASS|FAIL<TAB><description>[<TAB><detail>]
 *   TOTAL<TAB><number of CHECK lines emitted>
 * All whitespace in <text>/<description>/<detail> is collapsed to single
 * spaces so each record stays one line. Human-readable ajv diagnostics
 * (e.g. `unknown format "uri" ignored`) are written to stderr by ajv itself and
 * are inherited by the shell, so they stay visible.
 *
 * Exit status: 0 when the run COMPLETED (whatever the per-check results — the
 * shell decides the gate verdict), 2 when the runner itself could not run.
 *===========================================================================*/

const fs = require('fs');
const path = require('path');

const TESTS_DIR = __dirname;
const REPO_ROOT = path.resolve(TESTS_DIR, '..');
const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas', 'v1');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');

// The exact argv the shell gate used to hand the ajv CLI for every check.
const AJV_CLI_ARGV = { spec: 'draft2020', strict: false, 'all-errors': true };

// Loaded lazily so that requiring this file as a module (check-spec-drift.js
// asks it which examples the gate validates) never has the side effect of
// exiting the caller when ajv-cli is not installed.
let ajvFactory = null;

function loadAjvFactory() {
  if (ajvFactory) return ajvFactory;
  // ajv-cli's factory: builds the Ajv instance for a CLI argv (spec → Ajv
  // class, --strict/--all-errors → options, draft-06 meta-schema registration).
  const mod = require('ajv-cli/dist/commands/ajv.js');
  const factory = mod && mod.default;
  if (typeof factory !== 'function') throw new Error('ajv-cli factory export is not a function');
  ajvFactory = factory;
  return ajvFactory;
}

/*=============================================================================
 * Corpus tables — the gate's single source of truth for "what gets compiled".
 * STEP 4 (coverage) is computed from these same tables, so a schema file that
 * is not wired in here fails the gate loudly instead of being silently
 * uncovered (that is stronger than the previous arrangement, where the shell's
 * coverage list and the shell's compile commands were two hand-maintained
 * copies that had to agree).
 *===========================================================================*/

// Compiled standalone (no external $ref).
const STANDALONE_SCHEMAS = [
  'common.json',
  'result-request.json',
  'health-response.json',
  'error-response.json',
  'cancel-request.json',
  'cancel-response.json',
  'session-response.json',
  'session-terminate-response.json',
  'tool-call.json',
  'llm-call.json',
  'text-response.json',
  'wait.json',
  'delegate.json',
  'end.json',
  'test-report.json',
];

// The 6 decision sub-schemas: `-r` dependencies of decision.json.
const DECISION_SUBREFS = [
  'tool-call.json',
  'llm-call.json',
  'text-response.json',
  'wait.json',
  'delegate.json',
  'end.json',
];

// Entry schemas compiled with `-r` dependencies (not standalone).
const REF_ENTRY_SCHEMAS = ['process-request.json', 'decision.json'];

// Schemas that are ONLY compiled as `$ref` dependencies of another schema,
// never standalone. Kept explicit so STEP 4 can prove every file on disk is
// covered by one of these three lists.
const REF_SCHEMAS = [
  'common.json', // -r of process-request.json
  ...DECISION_SUBREFS, // -r of decision.json
];

/*=============================================================================
 * Output protocol
 *===========================================================================*/

let emitted = 0;

function clean(text, max = 400) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

function info(step, text) {
  process.stdout.write(`INFO\t${step}\t${clean(text, 300)}\n`);
}

function record(step, ok, desc, detail) {
  emitted += 1;
  const line = `CHECK\t${step}\t${ok ? 'PASS' : 'FAIL'}\t${clean(desc)}`;
  process.stdout.write(detail ? `${line}\t${clean(detail)}\n` : `${line}\n`);
}

/*=============================================================================
 * ajv helpers
 *===========================================================================*/

function readJson(absPath) {
  // Same decode the CLI uses for .json inputs (JSON.parse of the file text).
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function schemaPath(name) {
  return path.join(SCHEMAS_DIR, name);
}

function formatErrors(validate) {
  const errors = (validate && validate.errors) || [];
  if (!errors.length) return 'ajv reported invalid data with no errors';
  return errors
    .map((e) => `${e.instancePath || '/'} ${e.message || ''}${
      e.params && e.params.allowedValues ? ` (allowed: ${JSON.stringify(e.params.allowedValues)})` : ''
    }`.trim())
    .join('; ');
}

// One Ajv instance per (schema, refs) pair — as isolated as the one-process-per-
// check CLI path was — shared by every read-only check that needs the same
// compiled validator.
const buildCache = new Map();

function buildValidator(schemaFile, refFiles) {
  const key = `${schemaFile}::${refFiles.join(',')}`;
  if (buildCache.has(key)) return buildCache.get(key);

  const built = { ok: false, error: '', validate: null };
  try {
    const ajv = loadAjvFactory()(AJV_CLI_ARGV);
    for (const ref of refFiles) {
      const refSchema = readJson(schemaPath(ref));
      const refId = refSchema && refSchema.$id;
      ajv.addSchema(refSchema, refId ? undefined : schemaPath(ref));
    }
    const schema = readJson(schemaPath(schemaFile));
    const id = schema && schema.$id;
    ajv.addSchema(schema, id ? undefined : schemaPath(schemaFile));
    const validate = ajv.getSchema(id || schemaPath(schemaFile));
    if (typeof validate !== 'function') throw new Error('ajv returned no validator');
    built.validate = validate;
    built.ok = true;
  } catch (err) {
    built.error = err.message;
  }
  buildCache.set(key, built);
  return built;
}

/*=============================================================================
 * STEP 1 — compile checks
 *===========================================================================*/

const COMPILE_PLAN = [
  ...STANDALONE_SCHEMAS.map((s) => ({ desc: `compile ${s}`, schema: s, refs: [] })),
  { desc: 'compile process-request.json', schema: 'process-request.json', refs: ['common.json'] },
  { desc: 'compile decision.json', schema: 'decision.json', refs: DECISION_SUBREFS },
];

function runCompile(step, schemaFile, refs) {
  const built = buildValidator(schemaFile, refs);
  if (built.ok) {
    info(step, `schema schemas/v1/${schemaFile} is valid`);
    return { ok: true, detail: '' };
  }
  return { ok: false, detail: `schema schemas/v1/${schemaFile} is invalid — ${built.error}` };
}

/*=============================================================================
 * STEP 2 — example validation checks
 *===========================================================================*/

const FIXED_EXAMPLE_PLAN = [
  { data: 'examples/process-request.json', schema: 'process-request.json', refs: ['common.json'] },
  { data: 'examples/result-request.json', schema: 'result-request.json', refs: [] },
  { data: 'examples/cancel-request.json', schema: 'cancel-request.json', refs: [] },
  { data: 'examples/cancel-response.json', schema: 'cancel-response.json', refs: [] },
  { data: 'examples/session-response.json', schema: 'session-response.json', refs: [] },
  { data: 'examples/session-terminate-response.json', schema: 'session-terminate-response.json', refs: [] },
  { data: 'examples/health-response.json', schema: 'health-response.json', refs: [] },
  { data: 'examples/error-response.json', schema: 'error-response.json', refs: [] },
  { data: 'examples/test-report.json', schema: 'test-report.json', refs: [] },
  { data: 'examples/test-report-not-h3.json', schema: 'test-report.json', refs: [] },
];

function decisionExamples() {
  // Same corpus the shell globbed (`examples/decisions/*.json`), sorted so the
  // check count and order do not depend on readdir order.
  return fs
    .readdirSync(path.join(EXAMPLES_DIR, 'decisions'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      data: `examples/decisions/${f}`,
      schema: 'decision.json',
      refs: DECISION_SUBREFS,
      desc: `validate decisions/${f}`,
    }));
}

function runValidate(step, entry) {
  const built = buildValidator(entry.schema, entry.refs);
  if (!built.ok) {
    return { ok: false, detail: `schema ${entry.schema} could not be compiled — ${built.error}` };
  }
  let data;
  try {
    data = readJson(path.join(REPO_ROOT, entry.data));
  } catch (err) {
    return { ok: false, detail: `cannot read ${entry.data} — ${err.message}` };
  }
  const valid = built.validate(data);
  if (valid) {
    info(step, `${entry.data} valid`);
    return { ok: true, detail: '' };
  }
  return { ok: false, detail: `${entry.data} invalid — ${formatErrors(built.validate)}` };
}

/*=============================================================================
 * STEP 4 — coverage (no published schema may escape the gate)
 *===========================================================================*/

function schemaFilesOnDisk() {
  return fs
    .readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

/*=============================================================================
 * main
 *===========================================================================*/

function main() {
  // --- STEP 1 -------------------------------------------------------------
  for (const entry of COMPILE_PLAN) {
    const res = runCompile(1, entry.schema, entry.refs);
    record(1, res.ok, entry.desc, res.detail);
  }

  // --- STEP 2 -------------------------------------------------------------
  const validatePlan = [
    ...FIXED_EXAMPLE_PLAN.map((e) => ({ ...e, desc: `validate ${e.data}` })),
    ...decisionExamples(),
  ];
  for (const entry of validatePlan) {
    const res = runValidate(2, entry);
    record(2, res.ok, entry.desc, res.detail);
  }

  // --- STEP 4 -------------------------------------------------------------
  const covered = new Set([...STANDALONE_SCHEMAS, ...REF_ENTRY_SCHEMAS, ...REF_SCHEMAS]);
  for (const file of schemaFilesOnDisk()) {
    if (covered.has(file)) {
      record(4, true, `coverage: ${file} is validated by this script`);
    } else {
      record(
        4,
        false,
        `${file} — exists in schemas/v1/ but is NOT covered by this gate; add it to STANDALONE_SCHEMAS (no external $ref), REF_ENTRY_SCHEMAS or REF_SCHEMAS in tests/validate-all.js`
      );
    }
  }

  process.stdout.write(`TOTAL\t${emitted}\n`);
}

/**
 * Every example payload this runner validates, repo-relative — i.e. what the
 * gate's STEP 2 actually covers. tests/check-spec-drift.js check f) asserts that
 * every schema's example is wired into the gate; it calls this instead of
 * regex-scanning tests/validate-schemas.sh for `-d examples/...` lines, so the
 * assertion tracks the real wiring rather than the text of the script that used
 * to contain it (a text scan silently stops proving anything the moment the
 * validation moves).
 */
function validatedExamples() {
  return [
    ...FIXED_EXAMPLE_PLAN.map((e) => e.data),
    ...decisionExamples().map((e) => e.data),
  ].sort();
}

if (require.main === module) {
  try {
    loadAjvFactory();
  } catch (err) {
    process.stderr.write(
      `validate-all: cannot load ajv-cli from tests/node_modules (run \`npm install --prefix tests\`): ${err.message}\n`
    );
    process.exit(2);
  }
  try {
    main();
  } catch (err) {
    process.stderr.write(`validate-all: runner failed — ${err && err.stack ? err.stack : err}\n`);
    process.exit(2);
  }
}

module.exports = {
  AJV_CLI_ARGV,
  COMPILE_PLAN,
  validatedExamples,
};
