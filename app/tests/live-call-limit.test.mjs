import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveCallLimit } from '../src/live-call-limit.mjs';

test('live requests are serialized and a completed request releases the slot', () => {
  const limit = createLiveCallLimit();
  assert.equal(limit.acquire(0), true);
  assert.equal(limit.acquire(1), false);
  limit.release();
  assert.equal(limit.acquire(2), true);
});

test('six accepted requests exhaust the rolling minute and cooldown restores capacity', () => {
  const limit = createLiveCallLimit();
  for (let i = 0; i < 6; i++) {
    assert.equal(limit.acquire(i), true);
    limit.release();
  }
  assert.equal(limit.acquire(7), false);
  assert.equal(limit.acquire(59999), false);
  assert.equal(limit.acquire(60000), true);
});
