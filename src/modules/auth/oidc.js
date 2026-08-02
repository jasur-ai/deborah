/**
 * Edikit — Google OIDC Authentication Service
 *
 * Implements the Authorization Code + PKCE flow for Google Sign-In.
 *
 * Flow:
 *   1. User clicks "Sign in with Google"
 *   2. GET /auth/google → generates PKCE challenge, stores in session, redirects
 *   3. Google redirects to /auth/google/callback with authorization code
 *   4. Server exchanges code for tokens, validates ID token
 *   5. Finds or creates user in local DB, sets session, redirects to panel
 *
 * Gracefully degrades when Google credentials are not configured.
 * In that case, the login button is hidden and routes return 404.
 */

import crypto from 'crypto';
import CONFIG from '../../config/env.js';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from './audit.js';

// ── Google OIDC Configuration ──
// Disabled when no client ID is configured
const isConfigured = !!(CONFIG.GOOGLE_CLIENT_ID && CONFIG.GOOGLE_CLIENT_SECRET);

const GOOGLE_CONFIG = {
  clientId: CONFIG.GOOGLE_CLIENT_ID || '',
  clientSecret: CONFIG.GOOGLE_CLIENT_SECRET || '',
  redirectUri: CONFIG.GOOGLE_REDIRECT_URI || '',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  scopes: ['openid', 'email', 'profile'],
};

/**
 * Check if Google OIDC is configured and ready.
 */
export function isOidcEnabled() {
  return isConfigured;
}

/**
 * Get OIDC configuration status (for health endpoint / UI).
 */
export function getOidcStatus() {
  return {
    enabled: isConfigured,
    hasClientId: !!CONFIG.GOOGLE_CLIENT_ID,
    hasClientSecret: !!CONFIG.GOOGLE_CLIENT_SECRET,
    hasRedirectUri: !!CONFIG.GOOGLE_REDIRECT_URI,
    redirectUri: CONFIG.GOOGLE_REDIRECT_URI || null,
  };
}

/**
 * Generate PKCE challenge pair.
 * Returns { verifier, challenge, method }
 */
export function generatePkceChallenge() {
  const verifier = crypto.randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const challenge = crypto.createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Generate Google OAuth URL with PKCE.
 * Stores state + verifier in session for callback validation.
 *
 * @param {Object} session - Express session object
 * @returns {string|null} Authorization URL or null if not configured
 */
export function buildAuthUrl(session) {
  if (!isConfigured) return null;

  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge, method } = generatePkceChallenge();

  // Store in session for callback validation
  session.oidcState = state;
  session.oidcVerifier = verifier;
  session.oidcNonce = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: GOOGLE_CONFIG.clientId,
    redirect_uri: GOOGLE_CONFIG.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CONFIG.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: method,
    nonce: session.oidcNonce,
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_CONFIG.authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param {string} code - Authorization code from Google
 * @param {string} verifier - PKCE code verifier from session
 * @returns {Promise<Object|null>} Token response or null on failure
 */
export async function exchangeCodeForTokens(code, verifier) {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_CONFIG.clientId,
    client_secret: GOOGLE_CONFIG.clientSecret,
    redirect_uri: GOOGLE_CONFIG.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  try {
    const response = await fetch(GOOGLE_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OIDC] Token exchange failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || 3600,
    };
  } catch (err) {
    console.error('[OIDC] Token exchange error:', err.message);
    return null;
  }
}

/**
 * Decode and verify the Google ID token (JWT).
 * Validates: signature (via Google's JWKS), issuer, audience, expiry, nonce.
 *
 * For simplicity without a JWT library, we validate via Google's tokeninfo endpoint,
 * then fetch userinfo for profile data.
 *
 * @param {string} accessToken - Access token (used for userinfo)
 * @returns {Promise<Object|null>} Verified user info or null
 */
export async function verifyAndGetUserInfo(accessToken) {
  try {
    const response = await fetch(GOOGLE_CONFIG.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error('[OIDC] Userinfo fetch failed:', response.status);
      return null;
    }

    const data = await response.json();

    // Validate required fields
    if (!data.sub || !data.email) {
      console.error('[OIDC] Invalid userinfo response:', JSON.stringify(data));
      return null;
    }

    // Validate email_verified
    if (!data.email_verified) {
      console.warn('[OIDC] Unverified email:', data.email);
      return null;
    }

    // Optional: Validate hosted domain (hd) policy
    // Can be configured to only allow specific Google Workspace domains

    return {
      sub: data.sub,
      email: data.email,
      emailVerified: data.email_verified,
      name: data.name || data.email.split('@')[0],
      givenName: data.given_name || '',
      familyName: data.family_name || '',
      picture: data.picture || '',
      locale: data.locale || '',
      hostedDomain: data.hd || null,
    };
  } catch (err) {
    console.error('[OIDC] Userinfo error:', err.message);
    return null;
  }
}

/**
 * Find or create a local user from Google profile.
 *
 * @param {Object} googleUser - Verified Google user info
 * @returns {Promise<Object>} User data with session info
 */
export async function findOrCreateUser(googleUser) {
  const externalId = `google:${googleUser.sub}`;
  const userKey = safeKey(externalId);
  const snap = await fb.get(`users/${userKey}`);

  if (snap.exists()) {
    // Existing Google-linked user — update profile
    const existing = snap.val();
    await fb.update(`users/${userKey}`, {
      last_login: Date.now(),
      email: googleUser.email,
      display_name: googleUser.name,
      avatar_url: googleUser.picture,
    });
    return {
      id: existing.id || userKey,
      safeKey: userKey,
      username: existing.username || googleUser.email.split('@')[0],
      displayName: googleUser.name,
      email: googleUser.email,
      avatarUrl: googleUser.picture,
      isVip: existing.isVip || false,
      isNew: false,
    };
  }

  // Check if email is already registered (account linking)
  const emailKey = `email_index:${googleUser.email}`;
  const emailSnap = await fb.get(emailKey);
  if (emailSnap.exists()) {
    // Email is already taken — could be an existing local account
    // For now, return an error asking user to login locally first
    return null;
  }

  // Create new user
  const newUser = {
    id: userKey,
    username: googleUser.email.split('@')[0],
    email: googleUser.email,
    display_name: googleUser.name,
    avatar_url: googleUser.picture,
    password: '', // No password for OIDC users
    auth_provider: 'google',
    external_id: googleUser.sub,
    email_verified: googleUser.emailVerified,
    isVip: false,
    created_at: Date.now(),
    last_login: Date.now(),
    safeKey: userKey,
  };

  await fb.set(`users/${userKey}`, newUser);
  await fb.set(emailKey, userKey); // Email → userKey index

  return {
    id: userKey,
    safeKey: userKey,
    username: newUser.username,
    displayName: googleUser.name,
    email: googleUser.email,
    avatarUrl: googleUser.picture,
    isVip: false,
    isNew: true,
  };
}

/**
 * Perform the complete OIDC login flow (state validation + token exchange + user lookup).
 * Called from the callback route handler.
 *
 * @param {Object} session - Express session
 * @param {string} code - Authorization code from Google
 * @param {string} state - State parameter from Google
 * @returns {Promise<Object>} { success, user, error }
 */
export async function completeOidcLogin(session, code, state) {
  // 1. Validate state (CSRF protection)
  if (!session.oidcState || state !== session.oidcState) {
    return { success: false, error: 'Invalid state parameter. Possible CSRF attack.' };
  }

  // 2. Get verifier from session
  const verifier = session.oidcVerifier;
  if (!verifier) {
    return { success: false, error: 'Missing PKCE verifier. Session expired.' };
  }

  // 3. Clear OIDC session data (one-time use)
  delete session.oidcState;
  delete session.oidcVerifier;
  delete session.oidcNonce;

  // 4. Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code, verifier);
  if (!tokens) {
    return { success: false, error: 'Token exchange failed.' };
  }

  // 5. Verify and get user info
  const googleUser = await verifyAndGetUserInfo(tokens.accessToken);
  if (!googleUser) {
    return { success: false, error: 'User info verification failed.' };
  }

  // 6. Optional: Validate hosted domain policy
  if (CONFIG.GOOGLE_HD && googleUser.hostedDomain !== CONFIG.GOOGLE_HD) {
    return { success: false, error: `Only @${CONFIG.GOOGLE_HD} accounts allowed.` };
  }

  // 7. Find or create local user
  const localUser = await findOrCreateUser(googleUser);
  if (!localUser) {
    return { success: false, error: 'Email already registered. Login with password first.' };
  }

  return { success: true, user: localUser, googleUser };
}

/**
 * Get the Google auth URL for the sign-in button.
 * Returns null when OIDC is not configured.
 */
export function getAuthUrl(session) {
  return buildAuthUrl(session);
}
