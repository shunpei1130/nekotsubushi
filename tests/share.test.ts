import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sharePrepared, type ShareCard } from '../src/share.ts';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const blob = new Blob(['share image'], { type: 'image/png' });
const card: ShareCard = {
  url: 'https://nekotsubushi.vercel.app/?challenge=example',
  blob,
  file: new File([blob], 'nekotsubushi-03.png', { type: 'image/png' }),
  objectUrl: 'blob:share-card',
  text: '猫パンチ寸止めで残り0.080秒。この記録、超えられる？',
};

function navigatorWith(value: Record<string, unknown>) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
});

test('share includes the prepared PNG and challenge URL when the platform accepts files', async () => {
  let payload: ShareData | undefined;
  navigatorWith({
    canShare: (data: ShareData) => data.files?.[0] === card.file,
    share: async (data: ShareData) => { payload = data; },
  });
  assert.equal(await sharePrepared(card), 'shared');
  assert.equal(payload?.files?.[0], card.file);
  assert.ok(payload?.text?.includes(card.url), 'the file share also carries the playable challenge');
  assert.ok(payload?.text?.includes('0.080秒'), 'record precision is preserved');
});

test('share falls back to a playable link when native file sharing is unavailable', async () => {
  let payload: ShareData | undefined;
  navigatorWith({ canShare: () => false, share: async (data: ShareData) => { payload = data; } });
  assert.equal(await sharePrepared(card), 'shared');
  assert.equal(payload?.url, card.url);
  assert.equal(payload?.text, card.text);
  assert.equal(payload?.files, undefined);
});

test('a rejected canShare probe does not prevent otherwise supported link sharing', async () => {
  let shared = false;
  navigatorWith({
    canShare: () => { throw new TypeError('files are not supported'); },
    share: async (data: ShareData) => { assert.equal(data.url, card.url); shared = true; },
  });
  assert.equal(await sharePrepared(card), 'shared');
  assert.equal(shared, true);
});

test('closing the native share sheet is cancellation, not a failed or repeated share', async () => {
  let calls = 0;
  navigatorWith({
    share: async () => { calls++; throw new DOMException('User cancelled', 'AbortError'); },
  });
  assert.equal(await sharePrepared(card), 'cancelled');
  assert.equal(calls, 1);
});

test('missing native sharing and provider failure both expose the manual fallback', async () => {
  navigatorWith({});
  assert.equal(await sharePrepared(card), 'fallback');
  navigatorWith({ share: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  assert.equal(await sharePrepared(card), 'fallback');
});
