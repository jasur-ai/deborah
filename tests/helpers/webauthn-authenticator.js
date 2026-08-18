/**
 * Edikit — WebAuthn Authenticator Simulator (AUTH A-27 tests)
 *
 * Real kripto bilan ishlaydigan sun'iy authenticator:
 *   - ECDSA P-256 keypair (node:crypto)
 *   - COSE EC2 public key + CBOR attestationObject (fmt:'none')
 *   - ECDSA-SHA256 imzo (authData + clientDataHash ustida)
 *
 * Bu helper orqali unit + integration testlar haqiqiy WebAuthn
 * verification pipeline'ini (simplewebauthn v13) bosib o'tadi:
 * origin/rpId, challenge, counter, imzo — hammasi real tekshiriladi.
 *
 * @module tests/helpers/webauthn-authenticator
 */

import crypto from 'node:crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

/** ECDSA P-256 keypair + COSE public key. */
export function createKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return { publicKey, privateKey };
}

/** COSE EC2 key map: {1:kty, 3:alg, -1:crv, -2:x, -3:y}. */
export function coseKeyFromPublic(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return new Map([
    [1, 2],        // kty: EC2
    [3, -7],       // alg: ES256
    [-1, 1],       // crv: P-256
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]);
}

/**
 * AuthenticatorData yig'ish.
 * - Register: rpIdHash + flags(UP|UV|AT) + counter + AAGUID + credIdLen + credId + COSE
 * - Auth:     rpIdHash + flags(UP|UV) + counter (37 bayt)
 */
export function buildAuthData(rpId, flags, counter, { credId, publicKey } = {}) {
  const head = Buffer.concat([
    sha256(rpId),
    Buffer.from([flags]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(counter >>> 0, 0); return b; })(),
  ]);
  if (!credId || !publicKey) return head;

  const cose = encodeCBOR(coseKeyFromPublic(publicKey));
  const aaguid = Buffer.alloc(16);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(credId.length, 0);
  return Buffer.concat([head, aaguid, len, credId, cose]);
}

function clientDataJSON(type, challenge, origin) {
  return Buffer.from(JSON.stringify({
    type,
    challenge,
    origin,
    crossOrigin: false,
  }));
}

function sign(privateKey, data) {
  return crypto.sign('sha256', data, privateKey); // DER — simplewebauthn qabul qiladi
}

/** Registratsiya uchun to'liq credential (RegisterResponseJSON). */
export function createRegistrationResponse({ rpId, origin, challenge, publicKey, privateKey }) {
  const credId = crypto.randomBytes(32);
  const counter = 0;
  const flags = FLAG_UP | FLAG_UV | FLAG_AT; // 0x45

  const authData = buildAuthData(rpId, flags, counter, { credId, publicKey });
  const clientData = clientDataJSON('webauthn.create', challenge, origin);
  const clientDataHash = sha256(clientData);
  const signature = sign(privateKey, Buffer.concat([authData, clientDataHash]));

  const attestationObject = encodeCBOR(new Map([
    ['fmt', 'none'],
    ['attStmt', new Map()],
    ['authData', authData],
  ]));

  return {
    id: b64url(credId),
    rawId: b64url(credId),
    type: 'public-key',
    response: {
      clientDataJSON: b64url(clientData),
      attestationObject: b64url(attestationObject),
      transports: ['internal'],
    },
    clientExtensionResults: {},
  };
}

/** Autentifikatsiya uchun to'liq assertion (AuthenticationResponseJSON). */
export function createAuthenticationResponse({ rpId, origin, challenge, credId, publicKey, privateKey, counter, userHandle }) {
  const flags = FLAG_UP | FLAG_UV; // 0x05
  const authData = buildAuthData(rpId, flags, counter);
  const clientData = clientDataJSON('webauthn.get', challenge, origin);
  const clientDataHash = sha256(clientData);
  const signature = sign(privateKey, Buffer.concat([authData, clientDataHash]));

  return {
    id: b64url(credId),
    rawId: b64url(credId),
    type: 'public-key',
    response: {
      clientDataJSON: b64url(clientData),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
      userHandle: userHandle ? b64url(userHandle) : undefined,
    },
    clientExtensionResults: {},
  };
}
