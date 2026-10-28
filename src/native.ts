import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ShareCard } from './share';

export const PUBLIC_ORIGIN = 'https://nekotsubushi.vercel.app';
export function sharingOrigin(origin = globalThis.location?.origin ?? PUBLIC_ORIGIN): string {
  return /^https?:\/\//.test(origin) ? origin : PUBLIC_ORIGIN;
}
export const isNative = () => Capacitor.isNativePlatform();
/** Preserve the WKWebView custom-scheme host before third-party URL resolution. */
export const bundledAssetURL = (path: string, base = location.href) => new URL(path, base).href;
type NativeAsset = { uri: string };
const Video = registerPlugin<{ exportVideo(options: { imagePath: string }): Promise<NativeAsset> }>('SocialVideo');
const assets = new WeakMap<Blob, { image: Promise<NativeAsset>; video?: Promise<NativeAsset> }>();

export async function nativeAsset(card: ShareCard, video = false): Promise<NativeAsset> {
  let current = assets.get(card.blob);
  if (!current) {
    const image = (async () => {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error); reader.readAsDataURL(card.blob);
      });
      return Filesystem.writeFile({ path: `neko-share/${crypto.randomUUID()}.png`, directory: Directory.Cache, recursive: true, data });
    })();
    current = { image }; assets.set(card.blob, current);
  }
  if (!video) return current.image;
  current.video ??= current.image.then(image => Video.exportVideo({ imagePath: image.uri }));
  return current.video;
}
export async function removeNativeAssets(card: ShareCard): Promise<void> {
  const current = assets.get(card.blob); assets.delete(card.blob);
  if (!current) return;
  const { Filesystem } = await import('@capacitor/filesystem');
  for (const result of await Promise.allSettled([current.image, current.video].filter((p): p is Promise<NativeAsset> => !!p))) {
    if (result.status === 'fulfilled') try { await Filesystem.deleteFile({path:result.value.uri}); } catch {}
  }
}
export function wasCancelled(error: unknown): boolean {
  return !!error && typeof error === 'object' && ('name' in error && error.name === 'AbortError' || 'message' in error && /cancel(?:led|ed)?/i.test(String(error.message)));
}
export async function nativeShare(card: ShareCard, video = false, mediaOnly = false): Promise<'shared'|'cancelled'|'fallback'> {
  try {
    const { Share } = await import('@capacitor/share');
    const file = await nativeAsset(card, video);
    await Share.share({ title:'猫つぶし', files:[file.uri], ...(mediaOnly ? {} : {text:`${card.text}\n${card.url}`}) });
    return 'shared';
  } catch (error) { return wasCancelled(error) ? 'cancelled' : 'fallback'; }
}
export async function openExternal(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Unsupported external link');
  if (isNative()) { const { Browser } = await import('@capacitor/browser'); await Browser.open({url}); }
  else window.open(url, '_blank', 'noopener,noreferrer');
}
export async function nativeLifecycle(suspend: () => void, resumeClock: () => void, openLink: (query: string) => void) {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  const handle = (value: string) => {
    try { const u = new URL(value); if (u.protocol === 'nekotsubushi:' && u.host === 'play') openLink(u.search); } catch {}
  };
  await App.addListener('appStateChange', ({isActive}) => isActive ? resumeClock() : suspend());
  await App.addListener('appUrlOpen', event => handle(event.url));
  const launch = await App.getLaunchUrl(); if (launch) handle(launch.url);
}
