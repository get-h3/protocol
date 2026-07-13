#!/usr/bin/env node
/**
 * H3 Protocol — Round-trip + Validation Test
 *
 * Reads each example JSON file, validates it against the appropriate schema
 * using ajv, then checks that re-serialization is semantically lossless.
 *
 * Usage:  node tests/round-trip.js
 *         (run from repo root after npm install in tests/)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas', 'v1');
const EXAMPLES_DIR = path.join(ROOT, 'examples');
const DECISIONS_DIR = path.join(EXAMPLES_DIR, 'decisions');

// ---- Ajv setup -----------------------------------------------------------
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({
  spec: 'draft2020',
  strict: false,
  allErrors: true,
  validateSchema: false,
});

// Register format validators (date-time, uri, etc.)
addFormats(ajv);

// ---- Load all schemas ----------------------------------------------------
const schemaFiles = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json'));
const schemas = {};

for (const file of schemaFiles) {
  const filePath = path.join(SCHEMAS_DIR, file);
  const raw = fs.readFileSync(filePath, 'utf8');
  const schema = JSON.parse(raw);
  schemas[file] = schema;
  // Register by $id so relative $ref keywords resolve correctly
  ajv.addSchema(schema);
}

// ---- Test helpers --------------------------------------------------------
let passed = 0;
let failed = 0;

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return a === b;
}

function testExample(examplePath, schemaFile, label) {
  const raw = fs.readFileSync(examplePath, 'utf8');

  // --- Validate JSON can be parsed ---
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.log(`  ✗ FAIL: ${label} — invalid JSON (${err.message})`);
    failed++;
    return;
  }

  // --- Compile schema (resolves $ref from loaded schemas) ----
  const validate = ajv.compile(schemas[schemaFile]);
  const valid = validate(data);

  if (!valid) {
    console.log(`  ✗ FAIL: ${label} — schema validation`);
    if (validate.errors) {
      for (const e of validate.errors) {
        console.log(`         ${e.instancePath} ${e.message}`);
      }
    }
    failed++;
    return;
  }

  // --- Round-trip: parse → stringify → parse → compare ---
  const reSerialized = JSON.stringify(data);
  let reParsed;
  try {
    reParsed = JSON.parse(reSerialized);
  } catch (err) {
    console.log(`  ✗ FAIL: ${label} — re-serialization produced invalid JSON`);
    failed++;
    return;
  }

  if (!deepEqual(data, reParsed)) {
    console.log(`  ✗ FAIL: ${label} — round-trip semantic mismatch`);
    failed++;
    return;
  }

  console.log(`  ✓ PASS: ${label}`);
  passed++;
}

// ---- Test cases ----------------------------------------------------------
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  Round-Trip + Validation Tests                            ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

// process-request
testExample(
  path.join(EXAMPLES_DIR, 'process-request.json'),
  'process-request.json',
  'examples/process-request.json',
);

// result-request
testExample(
  path.join(EXAMPLES_DIR, 'result-request.json'),
  'result-request.json',
  'examples/result-request.json',
);

// All decision examples
const decisionFiles = fs.readdirSync(DECISIONS_DIR).filter((f) => f.endsWith('.json')).sort();
for (const f of decisionFiles) {
  testExample(
    path.join(DECISIONS_DIR, f),
    'decision.json',
    `examples/decisions/${f}`,
  );
}

// ---- Summary -------------------------------------------------------------
console.log('');
console.log('========================================');
console.log(`  Total: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}`);
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
