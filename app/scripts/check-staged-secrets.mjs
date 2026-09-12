// Read-only gate for the exact staged content. Never prints matches or secrets.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const paths = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean);
let localSecrets = [];
try {
  const env = await fs.readFile(new URL('../.env.local', import.meta.url), 'utf8');
  localSecrets = env.split(/\r?\n/).filter(line => /^[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)\s*=/.test(line))
    .map(line => line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')).filter(value => value.length >= 12);
} catch (error) { if (error.code !== 'ENOENT') throw new Error('LOCAL_SECRET_CHECK_UNAVAILABLE'); }
const forbiddenPath = /(^|\/)(?:\.env(?:\..+)?|node_modules|tmp|\.git)(\/|$)|\.(?:pem|key|p12|pfx)$/i;
const patterns = [/sk-[A-Za-z0-9._-]{24,}/g, /gh[pousr]_[A-Za-z0-9]{30,}/g, /github_pat_[A-Za-z0-9_]{30,}/g, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g];
const failures = [];
for (const file of paths) {
  if ((forbiddenPath.test(file) && !file.endsWith('/.env.example')) || /token-plan-authorization.*\.png$/.test(file)) {
    failures.push({ file, reason: 'PRIVATE_OR_GENERATED_PATH' }); continue;
  }
  const bytes = execFileSync('git', ['show', `:${file}`], { windowsHide: true, maxBuffer: 30 * 1024 * 1024 });
  const text = bytes.toString('utf8');
  if (localSecrets.some(value => text.includes(value)) || patterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(text); })) {
    failures.push({ file, reason: 'POSSIBLE_SECRET' });
  }
}
console.log(JSON.stringify({ stagedFiles: paths.length, localSecretValuesChecked: localSecrets.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
