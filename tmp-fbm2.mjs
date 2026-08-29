import { readFileSync } from 'fs';
import { createSign } from 'crypto';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sa = JSON.parse(readFileSync('/tmp/sa.json','utf8'));
const iat = Math.floor(Date.now()/1000);
const header = b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
const payload = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.readonly', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat+3600 }));
const sig = createSign('RSA-SHA256').update(header+'.'+payload).sign(sa.private_key.replace(/\\n/g,'\n'));
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header+'.'+payload+'.'+b64u(sig) }) })).json();
const H = { authorization: 'Bearer '+tok.access_token, accept: 'application/json' };
const P = sa.project_id;
const rL = await fetch(`https://firebase.googleapis.com/v1alpha1/projects/${P}/webApps`, { headers: H });
console.log('webApps HTTP', rL.status);
const d = await rL.json().catch(() => ({}));
const apps = d.apps || [];
for (const a of apps) console.log('webApp:', a.appId, '|', a.displayName || '');
if (!apps.length) console.log('javob:', JSON.stringify(d).slice(0, 250));
for (const a of apps) {
  const rC = await fetch(`https://firebase.googleapis.com/v1alpha1/projects/${P}/webApps/${a.appId}/config`, { headers: H });
  const c = await rC.json().catch(() => ({}));
  console.log('config', rC.status, '→ apiKey:', (c.apiKey ? c.apiKey.slice(0,12) + '…' : 'YOQ'), '| authDomain:', c.authDomain || '-');
}
