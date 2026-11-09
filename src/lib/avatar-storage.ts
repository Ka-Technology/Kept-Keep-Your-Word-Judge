// The profile photo's Storage calls (T47): pick or take a photo, crop it square where Kept's crop step
// placed it (T153), upload it to the user's own folder in the public `avatars` bucket, and clean up
// old files. The rules themselves are in
// avatar.ts (tested); this file only talks to the image picker and Supabase Storage.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { AVATAR_BUCKET, avatarPath, base64ToBytes } from '@/lib/avatar';
import { supabase } from '@/lib/supabase';

/** A photo chosen or taken, before it's cropped: where it is on the phone, and its size in pixels. */
export type ChosenPhoto = { uri: string; width: number; height: number };

/** A photo cropped square, ready to upload. */
export type PickedPhoto = { base64: string; mimeType: string };

// No editing in the picker: Kept's own crop step follows (T153; iOS's "Move and Scale" was easy to miss).
const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
// The square is shrunk to 512 px: it never shows larger than the photo viewer, and every avatar in a
// list downloads it (a phone's full-size crop was 1-2 MB each; performance review, 2026-10-04).
const SIDE = 512;

/** Opens the photo library (iOS needs no permission for its picker), or the camera after asking; null if cancelled. */
export async function pickPhoto(source: 'library' | 'camera'): Promise<ChosenPhoto | 'no-permission' | null> {
  if (source === 'camera') {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return 'no-permission';
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(OPTIONS) : await ImagePicker.launchImageLibraryAsync(OPTIONS);
  const asset = result.canceled ? null : result.assets[0];
  return asset ? { uri: asset.uri, width: asset.width, height: asset.height } : null;
}

/** Cuts `rect` (from cropRect() in avatar.ts) out of the photo, shrinks it to 512 px and makes it a JPEG. */
export async function cropPhoto(photo: ChosenPhoto, rect: { originX: number; originY: number; width: number; height: number }): Promise<PickedPhoto | null> {
  const context = ImageManipulator.manipulate(photo.uri).crop(rect);
  if (rect.width > SIDE) context.resize({ width: SIDE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG, base64: true });
  return saved.base64 ? { base64: saved.base64, mimeType: 'image/jpeg' } : null;
}

/** The photo's public address, for showing it. */
export function avatarUrl(path: string): string {
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Uploads a picked photo under a new name in the user's folder and returns its path. Throws if it fails. */
export async function uploadAvatar(userId: string, photo: PickedPhoto): Promise<string> {
  const path = avatarPath(userId, Date.now(), photo.mimeType);
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, base64ToBytes(photo.base64), { contentType: photo.mimeType });
  if (error) throw error;
  return path;
}

/** Deletes one photo file. Failures are ignored: a stray old file is harmless and hidden. */
export async function removeAvatarFile(path: string | null | undefined): Promise<void> {
  if (path) await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
}

/** Deletes every photo file in the user's folder, before their account is deleted (Storage doesn't cascade). */
export async function removeAllAvatars(userId: string): Promise<void> {
  const { data } = await supabase.storage.from(AVATAR_BUCKET).list(userId);
  if (data?.length) await supabase.storage.from(AVATAR_BUCKET).remove(data.map((file) => `${userId}/${file.name}`));
}
