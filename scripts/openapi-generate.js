/**
 * Deborah — Auth OpenAPI generator (AUTH D-30 §07)
 * ---------------------------------------------------------------------------
 * `src/modules/auth/contracts.js` ENDPOINTS registridan OpenAPI 3.1 spec
 * yaratadi (zod 4 native `toJSONSchema()` — yangi dependency yo'q).
 *
 * Chiqish: docs/openapi-auth.json (versionlanadi — §07).
 * CI'da tekshiruv: `node scripts/openapi-generate.js --validate` — spec
 * yaratiladi, struktura validatsiyadan o'tadi (§16).
 *
 * Qoidalar:
 *  - Response'da private field (password/token/otp/secret) skan (§11/§17) —
 *    yagona istisno: mfaEnrollResponse (enroll bir martalik secret).
 *  - Security scheme: sessionCookie + csrfToken (§25).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENDPOINTS, SECURITY_SCHEMES } from '../src/modules/auth/contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../docs/openapi-auth.json');

const PRIVATE_FIELD_RE = /\b(password|token|otp|secret)\b/i;
/** Enroll — yagona maqsadli istisno (§11): secret faqat MFA setup'da bir marta. */
const ENROLL_ALLOWED = ['POST /api/v1/mfa/enroll'];

function schemaToOpenAPI(schema) {
  if (!schema) return { type: 'object', additionalProperties: true };
  return schema.toJSONSchema();
}

/** Response schema'da private field skan — §17. */
export function scanPrivateFields(contract, endpointKey) {
  const json = contract.response ? JSON.stringify(contract.response.toJSONSchema()) : '';
  if (!PRIVATE_FIELD_RE.test(json)) return [];
  if (ENROLL_ALLOWED.includes(endpointKey)) return []; // maqsadli istisno
  return ['response'];
}

/** OpenAPI 3.1 spec yaratadi (§07). */
export function buildOpenApiSpec({ title = 'Deborah Auth API', version = '1.0.0' } = {}) {
  const paths = {};
  let privateFieldViolations = 0;

  for (const [endpoint, contract] of Object.entries(ENDPOINTS)) {
    const [method, routePath] = endpoint.split(' ');
    const lower = method.toLowerCase();
    const p = paths[routePath] || (paths[routePath] = {});
    const security = contract.auth ? [{ sessionCookie: [] }, { csrfToken: [] }] : [];

    const violations = scanPrivateFields(contract, endpoint);
    if (violations.length) privateFieldViolations += 1;

    p[lower] = {
      summary: `${method} ${routePath}`,
      security,
      requestBody: contract.request
        ? {
            required: true,
            content: { 'application/json': { schema: schemaToOpenAPI(contract.request) } },
          }
        : undefined,
      responses: {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: schemaToOpenAPI(contract.response) } },
        },
        '400': {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { ok: { type: 'boolean', enum: [false] }, error: { type: 'string' } },
                required: ['ok', 'error'],
              },
            },
          },
        },
        '429': {
          description: 'Rate limited (X-RateLimit-* headers, C-01 §09)',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean', enum: [false] },
                  error: { type: 'string', enum: ['RATE_LIMITED'] },
                  retryAfter: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    };
    // OpenAPI'da undefined requestBody chiqmasligi uchun tozalash
    if (!p[lower].requestBody) delete p[lower].requestBody;
  }

  return {
    openapi: '3.1.0',
    info: { title, version, description: 'Deborah auth API contract (D-30) — versionlanadi; breaking change → v2 (deprecation 6 oy, §24).' },
    servers: [{ url: '/api/v1' }],
    paths,
    components: { securitySchemes: SECURITY_SCHEMES },
    _meta: { privateFieldViolations, endpointCount: Object.keys(ENDPOINTS).length },
  };
}

/** Spec struktura validatsiyasi — §16 (swagger-lint o'rnini bosadi, dep yo'q). */
export function validateOpenApiSpec(spec) {
  const errors = [];
  if (spec.openapi !== '3.1.0') errors.push('openapi version != 3.1.0');
  if (!spec.info || !spec.info.title || !spec.info.version) errors.push('info missing');
  if (!spec.paths || Object.keys(spec.paths).length === 0) errors.push('no paths');
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    if (!p.startsWith('/')) errors.push(`path "${p}" not starting with /`);
    for (const [m, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) errors.push(`method "${m}" invalid`);
      if (!op.responses || !op.responses['200']) errors.push(`path ${p} ${m}: no 200 response`);
      if (op.requestBody && !op.requestBody.content['application/json']) errors.push(`path ${p} ${m}: no json body`);
    }
  }
  if (spec._meta && spec._meta.privateFieldViolations > 0) {
    errors.push(`private field violations: ${spec._meta.privateFieldViolations} (D-30 §11/§17)`);
  }
  return { ok: errors.length === 0, errors };
}

const main = () => {
  const validateOnly = process.argv.includes('--validate');
  const spec = buildOpenApiSpec();
  const { ok, errors } = validateOpenApiSpec(spec);
  if (!validateOnly) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(spec, null, 2));
    console.log(`[openapi] WROTE ${OUT} (${Object.keys(spec.paths).length} endpoints, ${spec._meta.endpointCount} contracts)`);
  }
  if (!ok) {
    console.error('[openapi] INVALID:', errors);
    process.exit(1);
  }
  console.log(`[openapi] VALID ✓ (private field violations: ${spec._meta.privateFieldViolations})`);
};

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
