// Profile photo rules (SPEC-identity.md, T47), pure so they're tested (avatar.test.ts): where a
// photo is stored, which paths a user may point at, the initial shown without a photo, and turning
// the picker's base64 into bytes for the upload. The Storage calls live in avatar-storage.ts.

import { MAX_ZOOM } from './pinch';

/** The Storage bucket for profile photos: public-read, writable only in your own folder. */
export const AVATAR_BUCKET = 'avatars';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * Where a new upload goes: `{user id}/{time}.{ext}`. A new name each time means a changed photo
 * never shows an old cached copy.
 */
export function avatarPath(userId: string, now: number, mimeType: string | null | undefined): string {
  return `${userId}/${now}.${EXTENSIONS[mimeType ?? ''] ?? 'jpg'}`;
}

/** The letter or digit shown in the circle when there's no photo. */
export function initialFor(username: string): string {
  return username.match(/[a-z0-9]/i)?.[0].toUpperCase() ?? '?';
}

/** The picker's base64 text as bytes (Hermes and Node both have atob). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The most a photo can be zoomed in the crop step (T153): as far as the photo viewer's pinch. */
export const CROP_ZOOM_MAX = MAX_ZOOM;

/** Where a photo sits in the crop circle: its zoom (1 covers the circle) and how far its center is moved, in points. */
export type CropView = { zoom: number; x: number; y: number };

type Size = { width: number; height: number };

/** Points per photo pixel at `zoom`, for a circle `side` points across that the photo covers at zoom 1. */
function cropScale(photo: Size, side: number, zoom: number): number {
  return Math.max(side / photo.width, side / photo.height) * zoom;
}

/** Keeps the zoom between 1 and CROP_ZOOM_MAX, and the photo covering the whole circle. */
export function clampCrop(photo: Size, side: number, view: CropView): CropView {
  const zoom = Math.min(CROP_ZOOM_MAX, Math.max(1, view.zoom));
  const scale = cropScale(photo, side, zoom);
  const room = (length: number) => Math.max(0, (length * scale - side) / 2);
  const clamp = (value: number, max: number) => Math.min(max, Math.max(-max, value)) || 0;
  return { zoom, x: clamp(view.x, room(photo.width)), y: clamp(view.y, room(photo.height)) };
}

/** The square of the photo inside the circle, in the photo's own pixels, for the crop. */
export function cropRect(photo: Size, side: number, view: CropView): { originX: number; originY: number; width: number; height: number } {
  const { zoom, x, y } = clampCrop(photo, side, view);
  const scale = cropScale(photo, side, zoom);
  const length = Math.min(photo.width, photo.height, Math.round(side / scale));
  const origin = (photoLength: number, offset: number) =>
    Math.min(photoLength - length, Math.max(0, Math.round(((photoLength * scale - side) / 2 - offset) / scale)));
  return { originX: origin(photo.width, x), originY: origin(photo.height, y), width: length, height: length };
}
