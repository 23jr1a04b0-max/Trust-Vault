import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';

const root=process.cwd();
const password='TrustVault-Production-Test!';
const trustedOrigin='https://vault.example.test';
async function freePort(){
  return await new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address().port;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}
async function waitReady(base,child,readOutput){
  for(let i=0;i<100;i++){
    if(child.exitCode!==null) throw new Error('Production-mode server exited: '+readOutput());
    try{const response=await fetch(base+'/api/health');if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Production-mode server failed to start: '+readOutput());
}

test('production HTTP origin checks and Secure session cookie',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'trustvault-origin-'));
  for(const path of ['server.mjs','db/schema.sql']){
    const dest=join(temp,path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,path),dest);
  }
  mkdirSync(join(temp,'data'),{recursive:true});
  const db=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  db.exec(await import('node:fs').then(m=>m.readFileSync(join(root,'db/schema.sql'),'utf8')));
  const salt=randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(id,email,display_name,role,password_hash,salt,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('test-viewer-id','viewer@trustvault.test','Production Test Viewer','Viewer',scryptSync(password,salt,64).toString('hex'),salt,new Date().toISOString());
  db.close();
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:temp,env:{...process.env,NODE_ENV:'production',PORT:String(port),AUDIT_HMAC_KEY:'test-only-audit-key-with-at-least-32-bytes',TRUSTED_ORIGINS:trustedOrigin},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',c=>output+=c.toString());child.stderr.on('data',c=>output+=c.toString());
  t.after(async()=>{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));rmSync(temp,{recursive:true,force:true});});
  await waitReady(base,child,()=>output);
  assert.equal((await fetch(base+'/api/health')).status,200,'health check remains available without Origin');
  const missing=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'viewer@trustvault.test',password,role:'Viewer'})});
  assert.equal(missing.status,403,'production must reject state-changing requests without Origin');
  const wrong=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:'https://attacker.example.test','content-type':'application/json'},body:JSON.stringify({email:'viewer@trustvault.test',password,role:'Viewer'})});
  assert.equal(wrong.status,403,'production must reject untrusted Origin');
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:trustedOrigin,'content-type':'application/json'},body:JSON.stringify({email:'viewer@trustvault.test',password,role:'Viewer'})});
  const loginText=await login.text();
  assert.equal(login.status,200,loginText);
  const cookie=login.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Secure/,'production session cookie must use Secure');
  const data=JSON.parse(loginText);
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{origin:trustedOrigin,cookie:cookie.split(';')[0],'x-csrf-token':data.csrfToken,'content-type':'application/json'},body:'{}'});
  assert.equal(logout.status,204,'trusted-origin logout with CSRF token should succeed');
});
