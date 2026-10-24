import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// Unlike tsx/Vitest or the bundled server, Vercel may load emitted ESM files
// directly. Keep a plain-Node startup check for the actual API import graph.
const root = process.cwd();
const output = fs.mkdtempSync(path.join(root, '.serverless-runtime-'));
function copy(file) {
  const destination = path.join(output, file.replace(/\.tsx?$/, '.js'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  fs.writeFileSync(destination, /\.tsx?$/.test(file)
    ? ts.transpileModule(content, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }}).outputText : content);
}
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:tsx?|m?js|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) copy(file);
  }
}
try {
  for (const directory of ['server', 'api', 'shared']) walk(directory);
  copy('server.ts');
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"module"}');
  const environment = Object.fromEntries(
    ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR'].flatMap(
      name => process.env[name] ? [[name, process.env[name]]] : [],
    ),
  );
  const run = (source, mode) => {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: output, env: { ...environment, NODE_ENV: mode, VERCEL: '1' },
      timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(result.trim());
  };
  run(`
    import {generateKeyPairSync} from 'node:crypto';
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,
      privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
    // Ephemeral, deliberately nonfunctional credentials validate startup only.
    Object.assign(process.env,{
      FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify({project_id:'runtime-check-only',
        client_email:'runtime-check@runtime-check-only.iam.gserviceaccount.com',private_key:privateKey}),
      GEMINI_API_KEY:'runtime-check-only',MERCADO_PAGO_ACCESS_TOKEN:'runtime-check-only',
      MERCADO_PAGO_WEBHOOK_SECRET:'runtime-check-only',INTERNAL_CRON_SECRET:'runtime-check-only-strong-enough'});
    const api=await import('./api/index.js');
    const fallback=await import('./api/[...path].js');
    const {getApp}=await import('./server.js');
    if(typeof api.default!=='function'||typeof fallback.default!=='function'||typeof await getApp()!=='function')
      throw new Error('serverless_startup_invalid');
    console.log('Native Node production API startup: passed');
  `, 'production');
  run(`
    import request from 'supertest';
    const {getApp}=await import('./server.js'); const app=await getApp();
    for(const [method,url,wanted] of [['get','/api/live',200],['get','/api/users/me',401],['post','/api/users/profile',401]]){
      const response=await request(app)[method](url);
      if(response.status!==wanted)throw new Error(method+' '+url+': '+response.status);
      console.log(method.toUpperCase()+' '+url+': '+response.status);
    }
  `, 'test');
} catch (error) {
  console.error('Serverless runtime validation failed:', error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
