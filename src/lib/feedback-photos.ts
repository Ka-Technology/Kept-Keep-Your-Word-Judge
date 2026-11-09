// Feedback photos (T158): a screenshot or photo from the library, shrunk to 1000 px like a check-in
// photo, in the private `feedback` bucket (0053). The rules are in feedback.ts (tested); this file only
// talks to the image picker, the image manipulator and Storage.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { base64ToBytes } from '@/lib/avatar';
import { resizeTo } from '@/lib/check-in';
import { supabase } from '@/lib/supabase';

const BUCKET = 'feedback';

/** Picks a photo from the library, as base64 JPEG, 1000 px on the long side; null if cancelled. */
export async function pickFeedbackPhoto(): Promise<{ base64: string; uri: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  const size = resizeTo(asset.width, asset.height);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  return saved.base64 ? { base64: saved.base64, uri: saved.uri } : null;
}

/** Uploads a photo to `path` (feedbackPhotoPath()). Throws if it fails. */
export async function uploadFeedbackPhoto(path: string, base64: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, base64ToBytes(base64), { contentType: 'image/jpeg' });
  if (error) throw error;
}

/** Deletes every feedback photo in the user's folder, before their account is deleted (Storage doesn't cascade). */
export async function removeAllFeedbackPhotos(userId: string): Promise<void> {
  // ponytail: one page of 1,000; 5 an hour makes more than that unlikely before an account is deleted.
  const { data: files } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((file) => `${userId}/${file.name}`));
}
