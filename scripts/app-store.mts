import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com';
type Resource = { id: string; type: string; attributes: Record<string, any> };
type Document = { data: Resource | Resource[] };
export type StoreImage = { name: string; display: string; bytes: Buffer };
export type Listing = { metadata: Record<string, any>; description: string; images: StoreImage[] };
export class StoreError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

/** No credentials are written to the checkout or included in error messages. */
export function makeToken(env: NodeJS.ProcessEnv, now = Math.floor(Date.now() / 1000)): string {
  for (const key of ['ASC_API_KEY_P8_BASE64', 'ASC_KEY_ID', 'ASC_ISSUER_ID']) {
    if (!env[key]) throw new StoreError('Missing protected GitHub Secret: ' + key);
  }
  if (!/^[A-Z0-9]{10}$/.test(env.ASC_KEY_ID!) || !/^[a-f0-9-]{36}$/i.test(env.ASC_ISSUER_ID!)) {
    throw new StoreError('Invalid App Store Connect key identifiers.');
  }
  try {
    const key = createPrivateKey(Buffer.from(env.ASC_API_KEY_P8_BASE64!, 'base64'));
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = encode({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' }) + '.' +
      encode({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
    return input + '.' + sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  } catch { throw new StoreError('Invalid protected App Store Connect P8 key.'); }
}

export async function loadListing(root = process.cwd()): Promise<Listing> {
  const metadata = JSON.parse(await readFile(resolve(root, 'ios/store/ja/metadata.json'), 'utf8'));
  const description = await readFile(resolve(root, 'ios/store/ja/description.txt'), 'utf8');
  const sources = [
    { file: 'fresh-ios-menu.png', display: 'APP_IPHONE_67', pixels: [1320, 2868] },
    ...Array.from({ length: 6 }, (_, i) => ({ file: `ios-game-${i + 1}.png`, display: 'APP_IPHONE_67', pixels: [1320, 2868] })),
    { file: 'ios-tiktok-video-ready.png', display: 'APP_IPHONE_67', pixels: [1320, 2868] },
    { file: 'ios-ipad-menu.png', display: 'APP_IPAD_PRO_3GEN_129', pixels: [2064, 2752] },
    { file: 'ios-ipad-share.png', display: 'APP_IPAD_PRO_3GEN_129', pixels: [2064, 2752] }
  ];
  const images: StoreImage[] = [];
  for (const source of sources) {
    const bytes = await readFile(resolve(root, 'artifacts/ios-native', source.file));
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) !== source.pixels[0] || bytes.readUInt32BE(20) !== source.pixels[1]) {
      throw new StoreError('Invalid native screenshot: ' + source.file);
    }
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    images.push({ name: `neko-${digest}-${source.file}`, display: source.display, bytes });
  }
  if (metadata.bundleId !== 'jp.shunpei1130.nekotsubushi' || !metadata.version || !description.trim()) {
    throw new StoreError('Invalid prepared store listing.');
  }
  return { metadata, description, images };
}

const relation = (type: string, id: string) => ({ data: { type, id } });
const asList = (doc: Document) => Array.isArray(doc.data) ? doc.data : [doc.data];
const asOne = (doc: Document) => asList(doc)[0];
export class AppleStoreClient {
  constructor(private token: () => string, private transport: typeof fetch = fetch) {}

  async api(path: string, method = 'GET', body?: unknown): Promise<Document> {
    if (!path.startsWith('/v1/')) throw new StoreError('Invalid Apple API path.');
    const response = await this.transport(API + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: 'Bearer ' + this.token(), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new StoreError('App Store Connect request failed: HTTP ' + response.status + '. Check app access, key permissions and Apple account agreements.', response.status);
    return response.status === 204 ? { data: [] } : await response.json() as Document;
  }

  async locale(parent: string, child: string, locale: string, attributes: Record<string, unknown>, parentType: string, parentId: string) {
    const found = asList(await this.api(`/v1/${parent}/${parentId}/${child}?limit=200`)).find(item => item.attributes.locale === locale);
    return asOne(await this.api(found ? `/v1/${child}/${found.id}` : `/v1/${child}`, found ? 'PATCH' : 'POST', {
      data: { type: child, ...(found ? { id: found.id } : {}), attributes: { ...attributes, ...(found ? {} : { locale }) },
        ...(found ? {} : { relationships: { [parentType]: relation(parent, parentId) } }) }
    }));
  }

  async upload(image: StoreImage, setId: string): Promise<string> {
    const items = asList(await this.api(`/v1/appScreenshotSets/${setId}/appScreenshots?limit=200`));
    let screenshot = items.find(item => item.attributes.fileName === image.name);
    if (screenshot && ['COMPLETE', 'UPLOAD_COMPLETE'].includes(screenshot.attributes.assetDeliveryState?.state)) return screenshot.id;
    if (!screenshot) {
      if (items.length >= 10) throw new StoreError('Screenshot set is full; existing images have been preserved.');
      screenshot = asOne(await this.api('/v1/appScreenshots', 'POST', { data: { type: 'appScreenshots',
        attributes: { fileName: image.name, fileSize: image.bytes.length },
        relationships: { appScreenshotSet: relation('appScreenshotSets', setId) } } }));
    }
    const operations = screenshot.attributes.uploadOperations;
    if (!Array.isArray(operations) || !operations.length) throw new StoreError('Apple did not provide screenshot upload operations.');
    const ranges: Array<[number, number]> = [];
    for (const operation of operations) {
      const { offset, length, method, url } = operation;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > image.bytes.length || method !== 'PUT' || new URL(url).protocol !== 'https:') {
        throw new StoreError('Invalid screenshot upload operation.');
      }
      ranges.push([offset, offset + length]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges[0][0] !== 0 || ranges.at(-1)![1] !== image.bytes.length || ranges.some((range, i) => i > 0 && range[0] !== ranges[i - 1][1])) {
      throw new StoreError('Incomplete or overlapping screenshot upload operations.');
    }
    for (const operation of operations) {
      // Presigned image delivery receives its own headers, never the ASC bearer.
      const response = await this.transport(operation.url, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: Object.fromEntries((operation.requestHeaders ?? []).map((h: { name: string; value: string }) => [h.name, h.value])),
        body: Uint8Array.from(image.bytes.subarray(operation.offset, operation.offset + operation.length)).buffer });
      if (!response.ok) throw new StoreError('Screenshot transfer failed: HTTP ' + response.status);
    }
    await this.api(`/v1/appScreenshots/${screenshot.id}`, 'PATCH', { data: { type: 'appScreenshots', id: screenshot.id,
      attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(image.bytes).digest('hex') } } });
    return screenshot.id;
  }

  async sync(listing: Listing): Promise<{ appId: string; versionId: string; screenshots: number }> {
    const { metadata, description, images } = listing;
    const app = asList(await this.api('/v1/apps?filter[bundleId]=' + encodeURIComponent(metadata.bundleId) + '&limit=200'))[0];
    if (!app) throw new StoreError('Create the initial app record in App Store Connect: name 猫つぶし, bundle jp.shunpei1130.nekotsubushi, primary language Japanese. Apple public API does not provide app creation.');
    if (app.attributes.bundleId !== metadata.bundleId) throw new StoreError('Apple returned a different app; no changes were made.');
    let version = asList(await this.api(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(metadata.version)}&limit=200`))[0];
    const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'];
    if (version && !editable.includes(version.attributes.appVersionState ?? version.attributes.appStoreState)) {
      throw new StoreError('The store version is already in review or distributed; no listing changes were made.');
    }
    if (!version) version = asOne(await this.api('/v1/appStoreVersions', 'POST', { data: { type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: metadata.version, releaseType: 'MANUAL', copyright: '2026 猫つぶし' },
      relationships: { app: relation('apps', app.id) } } }));
    const info = asList(await this.api(`/v1/apps/${app.id}/appInfos?limit=200`)).find(item => editable.includes(item.attributes.state ?? item.attributes.appStoreState));
    if (!info) throw new StoreError('No editable app information is available. Existing store information was preserved.');
    await this.locale('appInfos', 'appInfoLocalizations', metadata.locale, { name: metadata.name, subtitle: metadata.subtitle, privacyPolicyUrl: metadata.privacyPolicyURL }, 'appInfo', info.id);
    const localized = await this.locale('appStoreVersions', 'appStoreVersionLocalizations', metadata.locale,
      { description, supportUrl: metadata.supportURL }, 'appStoreVersion', version.id);
    let review: Resource | undefined;
    try { review = asOne(await this.api(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)); }
    catch (error) { if (!(error instanceof StoreError) || error.status !== 404) throw error; }
    await this.api(review ? `/v1/appStoreReviewDetails/${review.id}` : '/v1/appStoreReviewDetails', review ? 'PATCH' : 'POST', {
      data: { type: 'appStoreReviewDetails', ...(review ? { id: review.id } : {}), attributes: { notes: metadata.reviewNotes, demoAccountRequired: false },
        ...(review ? {} : { relationships: { appStoreVersion: relation('appStoreVersions', version.id) } }) }
    });
    const sets = asList(await this.api(`/v1/appStoreVersionLocalizations/${localized.id}/appScreenshotSets?limit=200`));
    const ids: string[] = [];
    for (const display of new Set(images.map(image => image.display))) {
      let set = sets.find(item => item.attributes.screenshotDisplayType === display);
      if (!set) set = asOne(await this.api('/v1/appScreenshotSets', 'POST', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: display },
        relationships: { appStoreVersionLocalization: relation('appStoreVersionLocalizations', localized.id) } } }));
      for (const image of images.filter(item => item.display === display)) ids.push(await this.upload(image, set.id));
    }
    const pending = new Set(ids), deadline = Date.now() + 180_000;
    while (pending.size) {
      for (const id of pending) {
        const state = asOne(await this.api('/v1/appScreenshots/' + id)).attributes.assetDeliveryState?.state;
        if (state === 'COMPLETE') pending.delete(id);
        else if (state === 'FAILED') throw new StoreError('Apple could not process a screenshot; uploaded images were preserved for inspection.');
      }
      if (!pending.size) break;
      if (Date.now() > deadline) throw new StoreError('Screenshot processing is pending in App Store Connect. Re-run after Apple finishes processing.');
      await new Promise(done => setTimeout(done, 2000));
    }
    return { appId: app.id, versionId: version.id, screenshots: ids.length };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const listing = await loadListing();
    if (process.argv.includes('--validate')) console.log('PASS prepared Japanese listing and ' + listing.images.length + ' original native screenshots. No Apple request was made.');
    else console.log('Prepared App Store listing:', await new AppleStoreClient(() => makeToken(process.env)).sync(listing));
  } catch (error) {
    console.error(error instanceof StoreError ? error.message : 'Store preparation failed. Check the protected credentials and prepared files.');
    process.exitCode = 1;
  }
}
