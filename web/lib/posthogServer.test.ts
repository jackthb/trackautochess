import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureServerEvent } from './posthogServer';

test('registration capture reports missing config, disabled analytics, rejected requests and timeouts', async () => {
  const keys = ['POSTHOG_PROJECT_TOKEN', 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'NEXT_PUBLIC_PRODUCT_ANALYTICS'] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let requests = 0;
  console.error = () => {};
  try {
    for (const key of keys) delete process.env[key];
    globalThis.fetch = async () => { requests++; return new Response('{}', { status: 200 }); };
    assert.equal(await captureServerEvent('Beta Waitlist Joined', 'test@example.invalid'), false);
    assert.equal(requests, 0);
    process.env.POSTHOG_PROJECT_TOKEN = 'test-only';
    process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS = 'false';
    assert.equal(await captureServerEvent('Beta Waitlist Joined', 'test@example.invalid'), false);
    assert.equal(requests, 0);
    delete process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS;
    for (const status of [400, 429, 500]) {
      globalThis.fetch = async () => new Response('{}', { status });
      assert.equal(await captureServerEvent('Beta Waitlist Joined', 'test@example.invalid'), false);
    }
    globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
    assert.equal(await captureServerEvent('Beta Waitlist Joined', 'test@example.invalid'), false);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.distinct_id, 'test@example.invalid');
      assert.equal(body.properties.$set.beta_waitlist, true);
      assert.ok(init?.signal);
      return new Response('{}', { status: 200 });
    };
    assert.equal(await captureServerEvent('Beta Waitlist Joined', 'test@example.invalid', {}, { personProperties: { beta_waitlist: true } }), true);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
