import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerNodeArgs } from '../src/server-launch.mjs';

test('server launcher enables supported environment proxy without changing its value', () => {
  const args = buildServerNodeArgs({
    env: { HTTPS_PROXY: 'http://127.0.0.1:7897' },
    supportedFlags: new Set(['--use-env-proxy']),
    serverPath: 'server.mjs'
  });
  assert.deepEqual(args, ['--use-env-proxy', 'server.mjs']);
  assert.ok(!JSON.stringify(args).includes('7897'));
});

test('server launcher preserves direct startup when proxy support is unavailable', () => {
  assert.deepEqual(buildServerNodeArgs({
    env: { HTTPS_PROXY: 'http://127.0.0.1:7897' },
    supportedFlags: new Set(),
    serverPath: 'server.mjs'
  }), ['server.mjs']);
  assert.deepEqual(buildServerNodeArgs({
    env: {},
    supportedFlags: new Set(['--use-env-proxy']),
    watch: true,
    serverPath: 'server.mjs'
  }), ['--watch', 'server.mjs']);
});
