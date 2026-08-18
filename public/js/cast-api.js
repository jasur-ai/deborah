/**
 * Deborah — Cast API Client
 * -------------------------
 * Har write request'ga CSRF header qo'shadi.
 * window.__BOOT__.csrfToken yoki window.__CSRF_TOKEN dan token oladi.
 */

(function (global) {
  'use strict';

  function csrfToken() {
    if (global.__BOOT__ && global.__BOOT__.csrfToken) return global.__BOOT__.csrfToken;
    if (global.__CSRF_TOKEN) return global.__CSRF_TOKEN;
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  }

  async function castFetch(path, options = {}) {
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase());
    const headers = Object.assign({}, options.headers || {});
    if (isWrite) {
      headers['content-type'] = headers['content-type'] || 'application/json';
      headers['x-csrf-token'] = csrfToken();
    }
    const res = await fetch(path, Object.assign({}, options, { headers }));
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) {}
      const err = new Error((body && (body.error?.message || body.message || body.error)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return res.json();
  }

  global.castFetch = castFetch;
  global.csrfToken = csrfToken;
})(window);
