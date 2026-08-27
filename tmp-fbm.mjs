import { readFileSync } from 'fs';
import { createSign } from 'crypto';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sa = JSON.parse(readFileSync('/tmp/sa.json','utf8'));
const iat = Math.floor(Date.now()/1000);
const header = b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
const payload = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat+3600 }));
const sig = createSign('RSA-SHA256').update(header+'.'+payload).sign(sa.private_key.replace(/\\n/g,'\n'));
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header+'.'+payload+'.'+b64u(sig) }) })).json();
const H = { authorization: 'Bearer '+tok.access_token, accept: 'application/json' };
const P = sa.project_id;
const rS = await fetch(`https://firebase.googleapis.com/v1alpha1/projects/-/webApps:search?parentId=projects/${P}`, { headers: H });
console.log('webApps search HTTP', rS.status);
const dS = await rS.json().catch(() => ({}));
for (const a of dS.apps || []) console.log('webApp:', a.appId, a.displayName || '', a.platform || '');
if (rS.status === 403 || rS.status === 404) console.log(JSON.stringify(dS).slice(0, 200));
for (const a of dS.apps || []) {
  const rC = await fetch(`https://firebase.googleapis.com/v1alpha1/projects/-/webApps/${a.appId}/config`, { headers: H });
  if (rC.ok) {
    const c = await rC.json();
    console.log('CONFIG', a.appId, '→ apiKey:', (c.apiKey||'').slice(0,10)+'…', '| authDomain:', c.authDomain, '| projectId:', c.projectId);
    // to'liq saqlash (workspace'ga emas — keyin Render env'ga)
  } else console.log('config HTTP', rC.status, (await rC.text()).slice(0,120));
}
