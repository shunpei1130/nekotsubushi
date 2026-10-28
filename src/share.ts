import { modes, asset } from './data';
import { encodeChallenge, formatResult, type RunContext, type RunResult } from './progression';
import { isNative, nativeShare, sharingOrigin } from './native';

export type SocialNetwork = 'x' | 'tiktok' | 'instagram';
export function shareLink(context: RunContext, result: RunResult): string {
  if (result.mode !== 5) return encodeChallenge(context, result, sharingOrigin());
  return new URL('/?mode=5', sharingOrigin()).href;
}
export function shareCaption(result: RunResult): string {
  return result.mode === 5 ? 'ほっぺむにむにで、もちもちの猫とひと休み。 #猫つぶし'
    : `${modes[result.mode-1].name}で${formatResult(result)}。この記録、超えられる？ #猫つぶし`;
}
export function xIntent(context: RunContext, result: RunResult): string {
  const url = new URL('https://x.com/intent/tweet');
  url.searchParams.set('text',shareCaption(result)); url.searchParams.set('url',shareLink(context,result));
  return url.href;
}
export async function shareSocial(card: ShareCard, target: SocialNetwork): Promise<'shared'|'fallback'|'cancelled'> {
  if (isNative()) return nativeShare(card,target==='tiktok',target!=='x');
  if (target==='x') return sharePrepared(card);
  try {
    if (typeof navigator.share!=='function' || navigator.canShare?.({files:[card.file]})!==true) return 'fallback';
    await navigator.share({files:[card.file]}); return 'shared';
  } catch (error) { return error instanceof Error && error.name==='AbortError' ? 'cancelled' : 'fallback'; }
}

export type ShareCard = {
  url: string;
  blob: Blob;
  file: File;
  objectUrl: string;
  text: string;
};

const FONT = '"Neko Rounded", "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
const BROWN = '#55331f';
const ORANGE = '#c77c25';

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function centered(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, color = BROWN, maxWidth = 940) {
  ctx.font = `800 ${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && size > 20) {
    size -= 1;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 540, y);
}

function imageAtNaturalRatio(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * ratio;
  const h = image.naturalHeight * ratio;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

async function loadSameOriginImage(path: string): Promise<HTMLImageElement> {
  const url = new URL(path, location.href);
  if (url.protocol !== location.protocol || url.host !== location.host) throw new Error('Share artwork must be hosted with the game');
  const image = new Image();
  image.decoding = 'async';
  image.src = url.href;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Share artwork is empty');
  return image;
}

/** Prepare before the share button is pressed so navigator.share keeps its user activation. */
export async function prepareShareCard(context: RunContext, result: RunResult, portraitAsset?: string): Promise<ShareCard> {
  const url = shareLink(context, result);
  const mode = modes[result.mode - 1];
  const primary = formatResult(result);
  const text = shareCaption(result);
  const fallback = asset(`m${String(result.mode).padStart(2, '0')}-${result.mode === 3 ? 'body' : 'cat'}`);
  const imagePromise = portraitAsset && portraitAsset !== fallback
    ? loadSameOriginImage(portraitAsset).catch(() => loadSameOriginImage(fallback))
    : loadSameOriginImage(fallback);
  const [image] = await Promise.all([imagePromise, document.fonts.ready]);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The share card could not be drawn');

  const background = ctx.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, '#fffaf0');
  background.addColorStop(1, '#f8e5c7');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1080, 1350);
  rounded(ctx, 28, 28, 1024, 1294, 52);
  ctx.strokeStyle = '#e9cda5';
  ctx.lineWidth = 2;
  ctx.stroke();

  centered(ctx, '猫つぶし。', 121, 76);
  centered(ctx, 'ひとゆび、ねこあそび。', 169, 25, '#9b7858');
  const courseLabel = context.dailyDate
    ? `${context.dailyDate.replaceAll('-', '.')} のねこチャレンジ`
    : result.mode === 5 ? '時間を忘れて、むに。' : '同じ条件で、ひと勝負。';
  ctx.font = `800 25px ${FONT}`;
  const badgeWidth = Math.min(900, ctx.measureText(courseLabel).width + 64);
  rounded(ctx, (1080 - badgeWidth) / 2, 192, badgeWidth, 48, 24);
  ctx.fillStyle = '#f3d9ad';
  ctx.fill();
  centered(ctx, courseLabel, 225, 25, '#8c5e32');

  ctx.save();
  ctx.shadowColor = '#87572b20';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  rounded(ctx, 64, 271, 952, 622, 40);
  ctx.fillStyle = '#fff9ec';
  ctx.fill();
  ctx.restore();
  ctx.save();
  rounded(ctx, 64, 271, 952, 622, 40);
  ctx.clip();
  const halo = ctx.createRadialGradient(540, 550, 30, 540, 550, 520);
  halo.addColorStop(0, '#ffedc8');
  halo.addColorStop(1, '#f5dfba');
  ctx.fillStyle = halo;
  ctx.fillRect(64, 271, 952, 622);
  imageAtNaturalRatio(ctx, image, 82, 284, 916, 596);
  ctx.restore();

  centered(ctx, mode.name, 961, 39);
  centered(ctx, primary, 1074, result.mode === 3 ? 82 : 100, ORANGE);
  let detail = '';
  if (result.mode === 5) detail = 'ひっぱって、離して。ふわふわを、ひとりじめ。';
  else if (result.mode === 6) detail = `ひやひや ${(result.nearMissMs / 1000).toFixed(3)} 秒`;
  else if (result.mode === 3) detail = result.success ? 'パンチまでの残り時間。小さいほど、おみごと。' : '次こそ、もう少し早く。';
  else if (result.mode === 4) detail = `ぴったり ${result.perfectCount} 回・最高 ${result.maxPerfectStreak} 連続`;
  else if (result.mode === 2) detail = `ぴったり ${result.perfectCount} 回・最高 ${result.maxStreak} 連続`;
  else detail = `最高 ${result.maxStreak} 連続${result.specialCount ? `・ギリギリ ${result.specialCount} 回` : ''}`;
  centered(ctx, detail, 1135, 27, '#9b7858');
  ctx.beginPath();
  ctx.moveTo(270, 1170);
  ctx.lineTo(810, 1170);
  ctx.strokeStyle = '#e1c7a3';
  ctx.lineWidth = 2;
  ctx.stroke();
  centered(ctx, result.mode === 5 ? 'このほっぺ、さわってみる？' : 'この記録、超えられる？', 1235, 40, '#b06d26');
  centered(ctx, new URL(url).host, 1290, 23, '#a1866c');

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
    if (value) resolve(value);
    else reject(new Error('The share card could not be saved'));
  }, 'image/png'));
  const file = new File([blob], `nekotsubushi-${String(result.mode).padStart(2, '0')}.png`, { type: 'image/png' });
  return { url, blob, file, objectUrl: URL.createObjectURL(blob), text };
}

/** Call directly from a user gesture; all image preparation has already completed. */
export async function sharePrepared(card: ShareCard): Promise<'shared' | 'fallback' | 'cancelled'> {
  if (isNative()) return nativeShare(card);
  if (typeof navigator.share !== 'function') return 'fallback';
  try {
    let canShareFile = false;
    try { canShareFile = navigator.canShare?.({ files: [card.file] }) === true; } catch { /* Link sharing may still work. */ }
    const payload: ShareData = canShareFile
      ? { title: '猫つぶしの挑戦状', text: `${card.text}\n${card.url}`, files: [card.file] }
      : { title: '猫つぶしの挑戦状', text: card.text, url: card.url };
    await navigator.share(payload);
    return 'shared';
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    return 'fallback';
  }
}

export async function copyChallenge(url: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch { /* Older Safari and denied clipboard access use the selected-text fallback. */ }
  const field = document.createElement('textarea');
  const previousFocus = document.activeElement;
  field.value = url;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
}

export function downloadShareCard(card: ShareCard): void {
  const link = document.createElement('a');
  link.href = card.objectUrl;
  link.download = card.file.name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export function revokeShareCard(card: ShareCard): void {
  URL.revokeObjectURL(card.objectUrl);
}
