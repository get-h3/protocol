#!/usr/bin/env node
/**
 * H3 Protocol — Spec drift check (STEP 5 of tests/validate-schemas.sh).
 *
 * `h3-protocol.yaml` is the declared source of truth for the H3 protocol, but
 * nothing mechanically verified that it, the `schemas/v1/*.json` corpus it
 * $refs, and the `examples/*.json` payloads agree. This checker asserts the
 * three surfaces still describe the same protocol.
 *
 * Checks (one ✓/✗ line each; exit code is non-zero if any check fails):
 *
 *   a) every $ref in h3-protocol.yaml resolves — the referenced FILE exists,
 *      every #/fragment resolves to a real node, and every internal #/... ref
 *      resolves inside the spec itself;
 *   b) no payload schema is written inline under paths (or under
 *      components.responses): every requestBody and every response media-type
 *      schema must be a $ref. This is the rule that catches a response body
 *      shape that exists only inside the YAML and therefore escapes every
 *      schema-level gate;
 *   c) components.schemas.Decision is equivalent to schemas/v1/decision.json —
 *      oneOf targets set-equal (basenames, since the spec writes
 *      ./schemas/v1/X.json and the schema writes X.json), each branch's
 *      discriminator const mapping to the right target, and the discriminator
 *      mapping keys/values set-equal to decision.json's enum / oneOf targets;
 *   d) every `common.json#/definitions/<Name>` $ref resolves to a definition
 *      that exists, and the consumed definition set is reported;
 *   e) every file in schemas/v1 is either referenced from the spec or declared
 *      OUT_OF_BAND below with a reason;
 *   f) every file in schemas/v1 has at least one example under examples/
 *      (or is declared NO_EXAMPLE with a reason), and that example is actually
 *      validated by the gate (STEP 2 — the in-process corpus in
 *      tests/validate-all.js, plus any example the shell script invokes
 *      directly).
 *
 * Usage:  node tests/check-spec-drift.js      (works from any cwd)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Paths ───────────────────────────────────────────────────────────────────
const TESTS_DIR = __dirname;
const REPO_ROOT = path.resolve(TESTS_DIR, '..');

// js-yaml is ALREADY installed — it is a transitive dependency of @redocly/cli
// under tests/node_modules. It is required by explicit path (not by module
// resolution) so this script works from any cwd, and so it adds NO new entry to
// tests/package.json / package-lock.json.
const jsYaml = require(path.join(TESTS_DIR, 'node_modules', 'js-yaml'));

const SPEC_PATH = path.join(REPO_ROOT, 'h3-protocol.yaml');
const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas', 'v1');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');
const GATE_SCRIPT = path.join(TESTS_DIR, 'validate-schemas.sh');

// ── Declared exceptions ─────────────────────────────────────────────────────
// A schema file that no path in the spec can reach needs an explicit reason, so
// that "not referenced" is a decision rather than an oversight. A stale entry
// (its file is referenced after all, or the file is gone) is itself a failure.
const OUT_OF_BAND = {
  'test-report.json':
    'CLI battery artifact — the JSON payload of `h3-test --json` (get-h3/shim), not an HTTP request or response body, so no path/response in the spec can $ref it',
};

// A published schema with no payload example must say why. A stale key (its
// file is gone, or an example exists anyway) is itself a failure.
const NO_EXAMPLE = {
  'common.json':
    'definitions bag — `definitions` container with no top-level payload of its own; its members are exercised through examples/process-request.json',
};

// Examples whose filename does not match their schema basename. Each pattern is
// asserted to match at least one file on disk, so an alias can never quietly
// point at nothing.
const EXAMPLE_ALIASES = {
  'decision.json': ['examples/decisions/*.json'],
  'text-response.json': ['examples/decisions/text.json'],
};

// ── Load the three surfaces ─────────────────────────────────────────────────
function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function listExamples(dir = EXAMPLES_DIR, prefix = 'examples') {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listExamples(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

const spec = jsYaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
const schemaFiles = fs
  .readdirSync(SCHEMAS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
const exampleFiles = listExamples();
const gateText = fs.existsSync(GATE_SCRIPT) ? fs.readFileSync(GATE_SCRIPT, 'utf8') : '';

// STEP 2 no longer runs `ajv validate -d examples/<file>` once per example inside
// the shell script: the per-assertion CLI spawns were replaced by ONE in-process
// runner (tests/validate-all.js, P6-03 host-load fix). Check f) still has to
// prove that every schema's example is actually validated BY THE GATE, so it now
// reads the examples out of the runner's own corpus instead of regex-scanning
// the shell for `-d` lines. Reading the wiring beats reading the prose: the
// runner cannot validate an example it does not list here.
let runnerExamples = null;
let runnerExamplesError = null;
try {
  runnerExamples = require(path.join(TESTS_DIR, 'validate-all.js')).validatedExamples();
  if (!Array.isArray(runnerExamples)) throw new Error('validatedExamples() did not return an array');
} catch (err) {
  runnerExamplesError = err.message;
}

// ── Small helpers ───────────────────────────────────────────────────────────
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Relative-ize a repo path for display. */
function rel(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

/** Basename of a $ref target, ignoring any #/fragment. */
function refBase(ref) {
  return path.posix.basename(String(ref).split('#')[0]);
}

/** True when the $ref points at a file under schemas/v1. */
function isSchemaFileRef(ref) {
  if (typeof ref !== 'string' || ref.startsWith('#')) return false;
  const abs = path.resolve(REPO_ROOT, ref.split('#')[0]);
  return path.dirname(abs) === SCHEMAS_DIR;
}

/** Collect every `$ref` string in a parsed document with its JSON-ish path. */
function collectRefs(node, at, out) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectRefs(v, `${at}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const child = at === '' ? key : `${at}.${key}`;
      if (key === '$ref' && typeof value === 'string') out.push({ ref: value, at: child });
      else collectRefs(value, child, out);
    }
  }
  return out;
}

/** RFC 6901 JSON-pointer resolution returning {found, value|missing}. */
function resolvePointer(doc, pointer) {
  if (pointer === '' || pointer === '/') return { found: true, value: doc };
  const parts = pointer
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return { found: false, missing: part };
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { found: false, missing: part };
      cur = cur[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, part)) return { found: false, missing: part };
      cur = cur[part];
    }
  }
  return { found: true, value: cur };
}

/**
 * True when the gate is wired to validate `relPath`: it is either cited
 * literally (or through a matching glob) in `gateText` — the shell script's own
 * CLI invocations and parity smokes — or listed in the in-process runner's
 * STEP 2 corpus (tests/validate-all.js), which is where every example check now
 * lives.
 */
function citedByGate(relPath) {
  if (runnerExamples && runnerExamples.includes(relPath)) return true;
  const tokens = gateText.match(/examples\/[A-Za-z0-9._*/-]+\.json/g) || [];
  return tokens.some((token) => {
    const rx = new RegExp(
      '^' + token.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$',
    );
    return rx.test(relPath);
  });
}

/** Every media-type schema reachable from paths/responses (check b). */
function mediaTypeSchemas(doc) {
  const targets = [];
  const addContent = (content, base) => {
    if (!content || typeof content !== 'object') return;
    for (const [mediaType, media] of Object.entries(content)) {
      if (!media || typeof media !== 'object') continue;
      targets.push({
        at: `${base}.content.${mediaType}.schema`,
        hasSchema: Object.prototype.hasOwnProperty.call(media, 'schema'),
        schema: media.schema,
      });
    }
  };

  for (const [specPath, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.includes(method) || !op || typeof op !== 'object') continue;
      const base = `paths[${specPath}].${method}`;
      if (op.requestBody && typeof op.requestBody === 'object' && !op.requestBody.$ref) {
        addContent(op.requestBody.content, `${base}.requestBody`);
      }
      for (const [code, response] of Object.entries(op.responses || {})) {
        if (!response || typeof response !== 'object' || response.$ref) continue;
        addContent(response.content, `${base}.responses[${code}]`);
      }
    }
  }

  for (const [name, response] of Object.entries((doc.components && doc.components.responses) || {})) {
    if (!response || typeof response !== 'object' || response.$ref) continue;
    addContent(response.content, `components.responses.${name}`);
  }
  return targets;
}

// ── Runner ──────────────────────────────────────────────────────────────────
let TOTAL = 0;
let PASSED = 0;
let FAILED = 0;

function check(label, fn) {
  TOTAL++;
  let result;
  try {
    result = fn() || {};
  } catch (err) {
    result = { problems: [`threw: ${err && err.stack ? err.stack : String(err)}`] };
  }
  const problems = result.problems || [];
  const info = result.info || [];
  if (problems.length === 0) {
    PASSED++;
    console.log(`  ✓ ${label}`);
  } else {
    FAILED++;
    console.log(`  ✗ ${label}`);
  }
  for (const line of info) console.log(`        ${line}`);
  for (const line of problems) console.log(`        ✗ ${line}`);
}

const ALL_REFS = collectRefs(spec, '', []);

// ── a) every $ref resolves ──────────────────────────────────────────────────
check('a) every $ref in h3-protocol.yaml resolves (file exists + fragment resolves)', () => {
  const problems = [];
  const uniqueFiles = new Set();
  let fileRefs = 0;
  let fragmentRefs = 0;
  let internalRefs = 0;
  let shorthandRefs = 0;

  for (const { ref, at } of ALL_REFS) {
    if (ref.startsWith('#')) {
      internalRefs++;
      const pointer = ref === '#' ? '' : ref.slice(1);
      const res = resolvePointer(spec, pointer);
      if (!res.found) {
        problems.push(`${at}: internal $ref '${ref}' does not resolve (missing '${res.missing}')`);
      }
      continue;
    }

    const hash = ref.indexOf('#');
    const filePart = hash === -1 ? ref : ref.slice(0, hash);
    const fragment = hash === -1 ? '' : ref.slice(hash + 1);
    const abs = path.resolve(REPO_ROOT, filePart);
    fileRefs++;
    uniqueFiles.add(abs);

    if (!fs.existsSync(abs)) {
      problems.push(`${at}: $ref '${ref}' — file '${filePart}' does not exist`);
      continue;
    }

    if (fragment !== '') {
      fragmentRefs++;
      if (!fragment.startsWith('/')) {
        shorthandRefs++;
        problems.push(
          `${at}: $ref '${ref}' — fragment '#${fragment}' is not a JSON pointer; this checker cannot resolve it (use #/path/to/node)`,
        );
        continue;
      }
      let doc;
      try {
        doc = readJson(abs);
      } catch (err) {
        problems.push(`${at}: $ref '${ref}' — ${filePart} is not valid JSON (${err.message})`);
        continue;
      }
      const res = resolvePointer(doc, fragment);
      if (!res.found) {
        problems.push(
          `${at}: $ref '${ref}' — fragment resolves to nothing in ${filePart} (missing '${res.missing}')`,
        );
      }
    }
  }

  return {
    problems,
    info: [
      `refs: ${ALL_REFS.length} occurrences — ${fileRefs} file refs (${uniqueFiles.size} unique files), ` +
        `${fragmentRefs} with #/fragments, ${internalRefs} internal #/… refs, ${shorthandRefs} unresolved shorthand`,
    ],
  };
});

// ── b) no inline payload schemas under paths ────────────────────────────────
check('b) every request/response media-type schema is a $ref (no inline payload schema)', () => {
  const problems = [];
  const targets = mediaTypeSchemas(spec);
  for (const { at, hasSchema, schema } of targets) {
    if (!hasSchema) {
      problems.push(`${at}: media type declares no schema`);
      continue;
    }
    if (!schema || typeof schema !== 'object') {
      problems.push(`${at}: schema is not an object (${JSON.stringify(schema)})`);
      continue;
    }
    if (typeof schema.$ref === 'string') continue;
    const shape = Object.keys(schema).filter((k) => k !== 'description').join(', ') || '(empty object)';
    problems.push(
      `${at}: INLINE payload schema — must be a $ref to schemas/v1/*.json; carries: ${shape}`,
    );
  }
  return {
    problems,
    info: [`media-type schemas checked: ${targets.length} (paths + components.responses)`],
  };
});

// ── c) Decision component ≡ schemas/v1/decision.json ────────────────────────
check('c) components.schemas.Decision is equivalent to schemas/v1/decision.json', () => {
  const problems = [];
  const component = (spec.components && spec.components.schemas && spec.components.schemas.Decision) || null;
  if (!component) return { problems: ['components.schemas.Decision is missing from the spec'] };
  const decisionDoc = readJson(path.join(SCHEMAS_DIR, 'decision.json'));

  const specOneOf = Array.isArray(component.oneOf) ? component.oneOf : null;
  if (!specOneOf) return { problems: ['components.schemas.Decision has no oneOf array'] };

  const specMembers = [];
  specOneOf.forEach((branch, i) => {
    if (!branch || typeof branch.$ref !== 'string') {
      problems.push(`components.schemas.Decision.oneOf[${i}]: branch is not a $ref (${JSON.stringify(branch)})`);
      return;
    }
    specMembers.push({ label: `oneOf[${i}]`, target: refBase(branch.$ref), const: branchConst(branch) });
  });

  const decisionBranches = Array.isArray(decisionDoc.oneOf) ? decisionDoc.oneOf : [];
  const decisionMembers = [];
  decisionBranches.forEach((branch, i) => {
    if (!branch || typeof branch !== 'object') {
      problems.push(`schemas/v1/decision.json oneOf[${i}]: branch is not an object`);
      return;
    }
    const refEntry = Object.entries(branch.properties || {}).find(
      ([key, value]) => key !== 'decision' && value && typeof value === 'object' && typeof value.$ref === 'string',
    );
    if (!refEntry) {
      problems.push(`schemas/v1/decision.json oneOf[${i}]: branch has no sub-schema $ref`);
      return;
    }
    decisionMembers.push({
      label: `decision.json oneOf[${i}]`,
      target: refBase(refEntry[1].$ref),
      const: branchConst(branch),
    });
  });

  function branchConst(branch) {
    const decision = branch && branch.properties && branch.properties.decision;
    return decision ? decision.const : undefined;
  }

  // 1. oneOf target SETS must be equal (normalised basenames).
  const specSet = new Set(specMembers.map((m) => m.target));
  const decisionSet = new Set(decisionMembers.map((m) => m.target));
  for (const t of specSet) {
    if (!decisionSet.has(t)) {
      problems.push(
        `components.schemas.Decision.oneOf targets '${t}' which is not a oneOf target of schemas/v1/decision.json`,
      );
    }
  }
  for (const t of decisionSet) {
    if (!specSet.has(t)) {
      problems.push(
        `schemas/v1/decision.json.oneOf targets '${t}' which is missing from components.schemas.Decision.oneOf`,
      );
    }
  }
  if (specSet.size !== specMembers.length) {
    problems.push('components.schemas.Decision.oneOf contains duplicate targets');
  }
  if (decisionSet.size !== decisionMembers.length) {
    problems.push('schemas/v1/decision.json oneOf contains duplicate targets');
  }

  // 2. discriminator mapping: keys ⇔ decision.json enum, values ⇔ oneOf targets.
  const discriminator = component.discriminator || null;
  if (!discriminator || discriminator.propertyName !== 'decision') {
    problems.push("components.schemas.Decision.discriminator.propertyName is not 'decision'");
  }
  const mapping = (discriminator && discriminator.mapping) || {};
  const mappingKeys = new Set(Object.keys(mapping));
  const enumValues = (decisionDoc.properties && decisionDoc.properties.decision && decisionDoc.properties.decision.enum) || [];
  const enumSet = new Set(enumValues);

  for (const key of mappingKeys) {
    if (!enumSet.has(key)) {
      problems.push(
        `discriminator mapping key '${key}' is not in schemas/v1/decision.json properties.decision.enum ` +
          `[${[...enumSet].join(', ')}]`,
      );
    }
  }
  for (const value of enumSet) {
    if (!mappingKeys.has(value)) {
      problems.push(
        `schemas/v1/decision.json discriminator value '${value}' has no components.schemas.Decision.discriminator.mapping entry`,
      );
    }
  }
  for (const [key, value] of Object.entries(mapping)) {
    if (!specSet.has(refBase(value))) {
      problems.push(
        `discriminator mapping['${key}'] → '${value}' is not one of the oneOf targets [${[...specSet].join(', ')}]`,
      );
    }
  }

  // 3. every branch carrying a const must map to its own target.
  for (const member of [...specMembers, ...decisionMembers]) {
    if (member.const === undefined) continue;
    if (!mappingKeys.has(member.const)) {
      problems.push(
        `${member.label}: properties.decision.const '${member.const}' has no discriminator mapping entry`,
      );
      continue;
    }
    const mapped = refBase(mapping[member.const]);
    if (mapped !== member.target) {
      problems.push(
        `${member.label}: properties.decision.const '${member.const}' maps to '${mapped}' but the branch targets '${member.target}'`,
      );
    }
  }
  for (const member of decisionMembers) {
    if (member.const === undefined) {
      problems.push(`${member.label}: branch does not declare properties.decision.const`);
    }
  }
  if (enumValues.length !== enumSet.size) {
    problems.push('schemas/v1/decision.json properties.decision.enum contains duplicates');
  }
  if (enumSet.size !== decisionMembers.length) {
    problems.push(
      `schemas/v1/decision.json enum has ${enumSet.size} values but oneOf has ${decisionMembers.length} branches`,
    );
  }

  return {
    problems,
    info: [
      `oneOf targets: ${[...specSet].sort().join(', ')}`,
      `discriminator keys: ${[...mappingKeys].sort().join(', ')}`,
    ],
  };
});

// ── d) common.json#/definitions/<Name> refs resolve ─────────────────────────
check('d) every common.json#/definitions/<Name> $ref resolves to an existing definition', () => {
  const problems = [];
  const common = readJson(path.join(SCHEMAS_DIR, 'common.json'));
  const definitions = common.definitions || {};
  const consumed = new Map(); // definition name -> [ref sites]

  for (const { ref, at } of ALL_REFS) {
    const match = /(^|\/)common\.json#\/definitions\/(.+)$/.exec(ref);
    if (!match) continue;
    const name = match[2].replace(/~1/g, '/').replace(/~0/g, '~');
    if (!Object.prototype.hasOwnProperty.call(definitions, name)) {
      problems.push(
        `${at}: $ref '${ref}' — definitions.'${name}' does not exist in schemas/v1/common.json ` +
          `[${Object.keys(definitions).join(', ')}]`,
      );
      continue;
    }
    if (!consumed.has(name)) consumed.set(name, []);
    consumed.get(name).push(at);
  }

  if (consumed.size === 0) {
    problems.push('no common.json#/definitions/<Name> $ref found in the spec (expected Message/Identity/Context)');
  }

  return {
    problems,
    info: [
      `consumed definitions (${consumed.size}): ` +
        ([...consumed.keys()].sort().map((n) => `${n} ← ${consumed.get(n).join(', ')}`).join(' | ') || 'none'),
      `declared but unconsumed: ${Object.keys(definitions).filter((n) => !consumed.has(n)).sort().join(', ')}`,
    ],
  };
});

// ── e) every schema file is referenced or declared out-of-band ──────────────
check('e) every schemas/v1 file is $ref-ed from the spec or declared OUT_OF_BAND', () => {
  const problems = [];
  const referenced = new Set(ALL_REFS.filter((r) => isSchemaFileRef(r.ref)).map((r) => refBase(r.ref)));

  for (const file of schemaFiles) {
    if (referenced.has(file)) {
      if (OUT_OF_BAND[file]) {
        problems.push(
          `schemas/v1/${file} is referenced from the spec but still listed in OUT_OF_BAND ` +
            `("${OUT_OF_BAND[file]}") — remove the stale declaration`,
        );
      }
      continue;
    }
    if (OUT_OF_BAND[file]) continue;
    problems.push(
      `schemas/v1/${file} is referenced by no $ref in h3-protocol.yaml and is not declared OUT_OF_BAND ` +
        `(if it is deliberately not an HTTP payload, add it to the OUT_OF_BAND map in this checker with a reason)`,
    );
  }

  for (const file of Object.keys(OUT_OF_BAND)) {
    if (!schemaFiles.includes(file)) {
      problems.push(`OUT_OF_BAND declares schemas/v1/${file}, which does not exist on disk`);
    }
  }

  return {
    problems,
    info: [
      `${referenced.size} schema files referenced from the spec, ${Object.keys(OUT_OF_BAND).length} declared out-of-band, ` +
        `${schemaFiles.length} files in schemas/v1`,
    ],
  };
});

// ── f) every schema file has a gate-validated example ───────────────────────
check('f) every schemas/v1 file has an example under examples/ that the gate validates', () => {
  const problems = [];
  let withExamples = 0;

  if (runnerExamplesError) {
    problems.push(
      `tests/validate-all.js could not be loaded, so the gate's STEP 2 corpus is unreadable: ` +
        `${runnerExamplesError}`,
    );
  }

  for (const file of schemaFiles) {
    const name = file.replace(/\.json$/, '');

    if (NO_EXAMPLE[file]) {
      const found = exampleFiles.filter((e) => path.posix.basename(e) === `${name}.json`);
      if (found.length > 0) {
        problems.push(
          `schemas/v1/${file} is declared NO_EXAMPLE but ${found.join(', ')} exists — remove the stale declaration`,
        );
      }
      continue;
    }

    const matches = new Set(exampleFiles.filter((e) => path.posix.basename(e) === `${name}.json`));
    const aliases = EXAMPLE_ALIASES[file] || [];
    for (const pattern of aliases) {
      const rx = new RegExp(
        '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$',
      );
      const hits = exampleFiles.filter((e) => rx.test(e));
      if (hits.length === 0) {
        problems.push(`EXAMPLE_ALIASES['${file}'] → '${pattern}' matches no file under examples/`);
      }
      hits.forEach((h) => matches.add(h));
    }

    if (matches.size === 0) {
      problems.push(
        `schemas/v1/${file} has no example under examples/ — add examples/${name}.json (validated in STEP 2) ` +
          `or declare it in NO_EXAMPLE with a reason`,
      );
      continue;
    }

    withExamples++;
    for (const example of matches) {
      if (!citedByGate(example)) {
        problems.push(
          `${example} covers schemas/v1/${file} but the gate never validates it — ` +
            `wire it into STEP 2 (tests/validate-all.js)`,
        );
      }
    }
  }

  for (const file of Object.keys(NO_EXAMPLE)) {
    if (!schemaFiles.includes(file)) {
      problems.push(`NO_EXAMPLE declares schemas/v1/${file}, which does not exist on disk`);
    }
  }
  for (const file of Object.keys(EXAMPLE_ALIASES)) {
    if (!schemaFiles.includes(file)) {
      problems.push(`EXAMPLE_ALIASES declares schemas/v1/${file}, which does not exist on disk`);
    }
  }

  return {
    problems,
    info: [
      `${withExamples} schema files with examples, ${Object.keys(NO_EXAMPLE).length} declared NO_EXAMPLE, ` +
        `${exampleFiles.length} example files under examples/`,
    ],
  };
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('');
console.log('----------------------------------------');
console.log(`  Spec drift checks: ${TOTAL}  |  Passed: ${PASSED}  |  Failed: ${FAILED}`);
console.log('----------------------------------------');
if (FAILED === 0) {
  console.log('  No spec drift detected.');
} else {
  console.log('  Spec drift detected!');
}
process.exit(FAILED === 0 ? 0 : 1);
