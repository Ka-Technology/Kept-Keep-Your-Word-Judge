// Check-in photos (T25, SPEC-verification.md): Kept's camera (or a screenshot, for screen-based
// habits), shrunk to 1000 px, and the private `check-in-photos` bucket. The rules are in
// check-in.ts (tested); this file only talks to the image picker, the image manipulator and Storage.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { base64ToBytes } from '@/lib/avatar';
import { resizeTo } from '@/lib/check-in';
import { supabase } from '@/lib/supabase';

const BUCKET = 'check-in-photos';

/**
 * Takes a photo with the camera (never the library), or picks a screenshot where the habit allows
 * one. Returns the photo as base64 JPEG, 1000 px on the long side; null if cancelled.
 */
export async function takeCheckInPhoto(source: 'camera' | 'screenshot'): Promise<string | 'no-permission' | null> {
  if (source === 'camera') {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return 'no-permission';
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  const size = resizeTo(asset.width, asset.height);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  return saved.base64 ?? null;
}

/** Uploads a photo to `path` (checkInPhotoPath()). Throws if it fails. */
export async function uploadCheckInPhoto(path: string, base64: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, base64ToBytes(base64), { contentType: 'image/jpeg' });
  if (error) throw error;
}

/** A private photo's address for showing it, valid for an hour; null if it can't be read. */
export async function checkInPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** Deletes one photo, e.g. the old one after a retake. Failures are ignored: the file is private. */
export async function removeCheckInPhoto(path: string | null | undefined): Promise<void> {
  if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}

/** Deletes every check-in photo in the user's folder, before their account is deleted (Storage doesn't cascade). */
export async function removeAllCheckInPhotos(userId: string): Promise<void> {
  const { data: challenges } = await supabase.storage.from(BUCKET).list(userId);
  for (const folder of challenges ?? []) {
    const prefix = `${userId}/${folder.name}`;
    // ponytail: one page of 1,000 per challenge; a 365-day challenge with retakes stays well under it.
    const { data: files } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((file) => `${prefix}/${file.name}`));
  }
}
