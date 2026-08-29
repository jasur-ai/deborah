import { readFileSync } from 'fs';
import { createSign } from 'crypto';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sa = JSON.parse(readFileSync('/tmp/sa.json','utf8'));
const iat = Math.floor(Date.now()/1000);
const header = b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
const payload = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat+3600 }));
const sig = createSign('RSA-SHA256').update(header+'.'+payload).sign(sa.private_key.replace(/\\n/g,'\n'));
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header+'.'+payload+'.'+b64u(sig) }) })).json();
const H = { authorization: 'Bearer '+tok.access_token, accept: 'application/json' };
const P = sa.project_id;
const rL = await fetch(`https://apikeys.googleapis.com/v1/projects/${P}/keys`, { headers: H });
console.log('keys HTTP', rL.status);
if (rL.ok) {
  const d = await rL.json();
  console.log('jami:', (d.keys||[]).length);
  for (const k of d.keys || []) {
    const restrictions = JSON.stringify(k.restrictions || {}).slice(0,140);
    console.log('key:', k.displayName || k.name.split('/').pop(), '| restrictions:', restrictions);
    if (k.keyString) console.log('  keyString:', k.keyString);
  }
} else {
  console.log((await rL.text()).slice(0, 300));
}
