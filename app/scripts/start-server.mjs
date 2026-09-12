import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildServerNodeArgs } from '../src/server-launch.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
const args = buildServerNodeArgs({
  env: process.env,
  supportedFlags: process.allowedNodeEnvironmentFlags,
  watch: process.argv.slice(2).includes('--watch'),
  serverPath
});
const child = spawn(process.execPath, args, {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});

child.on('error', (error) => {
  console.error(`GlobalGuard server failed to start: ${error.code || 'SPAWN_ERROR'}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = Number.isInteger(code) ? code : 1;
});
