import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { AppleStoreClient, loadListing, makeToken, type Listing } from '../scripts/app-store.mts';

const metadata = { bundleId: 'jp.shunpei1130.nekotsubushi', version: '1.0.0', locale: 'ja', name: '猫つぶし', subtitle: 'ひとゆび、ねこあそび。', privacyPolicyURL: 'https://nekotsubushi.vercel.app/privacy.html', supportURL: 'https://nekotsubushi.vercel.app/privacy.html', reviewNotes: 'No login. Native video export.' };
const listing: Listing = { metadata, description: 'Prepared Japanese description', images: [
  { name: 'neko-abcdef-phone.png', display: 'APP_IPHONE_67', bytes: Buffer.from('phone-image') },
  { name: 'neko-abcdef-tablet.png', display: 'APP_IPAD_PRO_3GEN_129', bytes: Buffer.from('tablet-image') }
] };

function apple(options: { missing?: boolean; state?: string; bundle?: string; invalidRange?: boolean } = {}) {
  const calls: { path: string; method: string; data?: any; headers: Headers; bytes?: Buffer }[] = [];
  const resources: any[] = [];
  const response = (data: any, status = 200) => new Response(JSON.stringify({ data }), { status });
  const transport = async (url: any, init: RequestInit = {}) => {
    const u = new URL(String(url)), method = init.method ?? 'GET', headers = new Headers(init.headers);
    if (u.hostname === 'uploads.example') {
      const bytes = Buffer.from(init.body as ArrayBuffer);
      calls.push({ path: u.pathname, method, headers, bytes });
      assert.equal(headers.get('Authorization'), null, 'ASC credentials must never reach asset delivery');
      return new Response('', { status: 200 });
    }
    assert.equal(u.origin, 'https://api.appstoreconnect.apple.com');
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-test-token');
    const data = init.body ? JSON.parse(String(init.body)).data : undefined;
    calls.push({ path: u.pathname, method, data, headers });
    if (u.pathname === '/v1/apps') return response(options.missing ? [] : [{ id: 'app', type: 'apps', attributes: { bundleId: options.bundle ?? metadata.bundleId } }]);
    if (u.pathname === '/v1/apps/app/appStoreVersions') {
      assert.equal(u.searchParams.get('filter[platform]'), 'IOS');
      assert.equal(u.searchParams.get('filter[versionString]'), '1.0.0');
      return response(options.state ? [{ id: 'version', type: 'appStoreVersions', attributes: { appVersionState: options.state } }] : resources.filter(r => r.type === 'appStoreVersions'));
    }
    if (u.pathname === '/v1/apps/app/appInfos') return response([{ id: 'info', type: 'appInfos', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }]);
    if (method === 'GET' && /\/appStoreReviewDetail$/.test(u.pathname)) {
      const review = resources.find(r => r.type === 'appStoreReviewDetails');
      return review ? response(review) : response(null, 404);
    }
    if (method === 'GET' && /\/(appInfoLocalizations|appStoreVersionLocalizations|appScreenshotSets|appScreenshots)$/.test(u.pathname)) {
      const type = u.pathname.split('/').at(-1);
      const parent = u.pathname.split('/').at(-2);
      return response(resources.filter(r => r.type === type && (type !== 'appScreenshots' || r.relationships.appScreenshotSet.data.id === parent)));
    }
    if (method === 'GET' && /^\/v1\/appScreenshots\//.test(u.pathname)) return response(resources.find(r => r.id === u.pathname.split('/').at(-1)));
    if (method === 'POST') {
      const item = { ...data, id: 'resource-' + resources.length, attributes: { ...data.attributes } };
      if (item.type === 'appStoreVersions') {
        assert.equal(item.relationships.app.data.type, 'apps');
        assert.equal(item.attributes.releaseType, 'MANUAL');
        item.attributes.appVersionState = 'PREPARE_FOR_SUBMISSION';
      }
      if (item.type === 'appScreenshots') {
        const size = item.attributes.fileSize, half = Math.floor(size / 2);
        item.attributes.uploadOperations = [
          { method: 'PUT', url: 'https://uploads.example/' + item.id + '/a', offset: 0, length: options.invalidRange ? half - 1 : half },
          { method: 'PUT', url: 'https://uploads.example/' + item.id + '/b', offset: half, length: size - half }
        ];
        item.attributes.assetDeliveryState = { state: 'AWAITING_UPLOAD' };
      }
      resources.push(item); return response(item, 201);
    }
    if (method === 'PATCH') {
      const item = resources.find(r => r.id === data.id);
      assert.ok(item);
      Object.assign(item.attributes, data.attributes);
      if (item.type === 'appScreenshots') item.attributes.assetDeliveryState = { state: 'COMPLETE' };
      return response(item);
    }
    throw new Error('Unexpected test request: ' + method + ' ' + u.pathname);
  };
  return { client: new AppleStoreClient(() => 'synthetic-test-token', transport as typeof fetch), calls, resources };
}

test('App Store JWT is a verifiable short-lived ES256 token for the expected audience', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { ASC_KEY_ID: 'ABC123DE45', ASC_ISSUER_ID: '12345678-1234-1234-1234-123456789abc', ASC_API_KEY_P8_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  const [header, payload, signature] = makeToken(env, 1000).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { iss: env.ASC_ISSUER_ID, iat: 1000, exp: 1600, aud: 'appstoreconnect-v1' });
  assert.ok(verify('sha256', Buffer.from(header + '.' + payload), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});

test('Missing or malformed protected credentials fail without exposing key material', () => {
  assert.throws(() => makeToken({}), /Missing protected GitHub Secret: ASC_API_KEY_P8_BASE64/);
  const secret = 'private-material-must-not-be-logged';
  assert.throws(() => makeToken({ ASC_KEY_ID: 'ABC123DE45', ASC_ISSUER_ID: '12345678-1234-1234-1234-123456789abc', ASC_API_KEY_P8_BASE64: secret }), error => error instanceof Error && !error.message.includes(secret) && /Invalid protected/.test(error.message));
});

test('The actual prepared store listing contains ten original screenshots with valid target dimensions', async () => {
  const prepared = await loadListing();
  assert.equal(prepared.images.length, 10);
  assert.equal(prepared.images.filter(image => image.display === 'APP_IPHONE_67').length, 8);
  assert.equal(prepared.images.filter(image => image.display === 'APP_IPAD_PRO_3GEN_129').length, 2);
  assert.match(prepared.description, /6つ/);
});

test('An absent or different app stops before mutations and does not try unsupported app creation', async () => {
  for (const options of [{ missing: true }, { bundle: 'another.owners.app' }]) {
    const mock = apple(options);
    await assert.rejects(mock.client.sync(listing), /initial app record|different app/);
    assert.ok(mock.calls.every(call => call.method === 'GET'));
  }
});

test('A version already in review or distribution is preserved', async () => {
  for (const state of ['IN_REVIEW', 'READY_FOR_DISTRIBUTION', 'WAITING_FOR_REVIEW']) {
    const mock = apple({ state });
    await assert.rejects(mock.client.sync(listing), /no listing changes/);
    assert.ok(mock.calls.every(call => call.method === 'GET'));
  }
});

test('Prepared listing, review notes and multipart screenshot bytes follow the Apple contract without submitting review', async () => {
  const mock = apple();
  assert.deepEqual(await mock.client.sync(listing), { appId: 'app', versionId: 'resource-0', screenshots: 2 });
  const info = mock.resources.find(r => r.type === 'appInfoLocalizations');
  assert.equal(info.relationships.appInfo.data.type, 'appInfos');
  assert.equal(info.attributes.privacyPolicyUrl, metadata.privacyPolicyURL);
  const review = mock.resources.find(r => r.type === 'appStoreReviewDetails');
  assert.equal(review.attributes.demoAccountRequired, false);
  assert.equal(review.attributes.notes, metadata.reviewNotes);
  for (const image of listing.images) {
    const resource = mock.resources.find(r => r.type === 'appScreenshots' && r.attributes.fileName === image.name);
    const bytes = Buffer.concat(mock.calls.filter(c => c.bytes && c.path.includes(resource.id)).map(c => c.bytes!));
    assert.deepEqual(bytes, image.bytes);
    assert.equal(resource.attributes.sourceFileChecksum, createHash('md5').update(image.bytes).digest('hex'));
  }
  assert.ok(mock.calls.every(c => !/reviewSubmissions|appStoreVersionSubmissions/.test(c.path)));
});

test('Retry reuses versions and completed images without duplicate uploads or deleting existing resources', async () => {
  const mock = apple();
  await mock.client.sync(listing);
  mock.calls.length = 0;
  await mock.client.sync(listing);
  assert.equal(mock.calls.filter(c => c.method === 'POST' || c.method === 'PUT' || c.method === 'DELETE').length, 0);
});

test('Incomplete screenshot ranges are rejected before sending any image bytes', async () => {
  const mock = apple({ invalidRange: true });
  await assert.rejects(mock.client.sync(listing), /Incomplete or overlapping/);
  assert.equal(mock.calls.filter(c => c.method === 'PUT').length, 0);
});

test('Apple authorization errors expose status and recovery context, not server bodies or credentials', async () => {
  const client = new AppleStoreClient(() => 'never-log-this-token', async () => new Response('private-server-detail', { status: 403 }));
  await assert.rejects(client.api('/v1/apps'), error => error instanceof Error && /HTTP 403/.test(error.message) && !/never-log|private-server/.test(error.message));
});
