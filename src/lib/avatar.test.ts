/// <reference types="node" />
// Unit tests for avatar.ts: where a profile photo is stored, the initial shown without one, and
// turning the picker's base64 into bytes for the upload.
import { readFileSync } from 'fs';
import { join } from 'path';

import { AVATAR_BUCKET, avatarPath, base64ToBytes, clampCrop, CROP_ZOOM_MAX, cropRect, initialFor } from './avatar';

describe('avatarPath', () => {
  it('puts each upload in the user’s own folder under a new name, so a changed photo shows at once', () => {
    expect(avatarPath('user-a', 1727340000000, 'image/jpeg')).toBe('user-a/1727340000000.jpg');
    expect(avatarPath('user-a', 1727340000001, 'image/png')).toBe('user-a/1727340000001.png');
  });

  it('treats an unknown type as JPEG', () => {
    expect(avatarPath('user-a', 5, undefined)).toBe('user-a/5.jpg');
  });
});

describe('initialFor', () => {
  it.each([
    ['mr.kangs', 'M'],
    ['9lives', '9'],
    ['._ada', 'A'],
    ['', '?'],
  ])('%p shows %p', (username, initial) => {
    expect(initialFor(username)).toBe(initial);
  });
});

describe('base64ToBytes', () => {
  it('turns the picker’s base64 into the exact bytes', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const base64 = Buffer.from(bytes).toString('base64');
    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(bytes));
  });
});

describe('the app mirrors the photo migration', () => {
  const migration = readFileSync(join(__dirname, '../../supabase/migrations/0008_profile_photos.sql'), 'utf8');

  it('uses the same bucket and the same own-folder rule', () => {
    expect(migration).toContain(`'${AVATAR_BUCKET}'`);
    expect(migration).toContain("avatar_path like id::text || '/%'");
  });
});

describe('the photo crop (T153): a circle `side` points across over the photo, zoomed and moved', () => {
  const square = { width: 1000, height: 1000 };
  const wide = { width: 2000, height: 1000 };

  it('at zoom 1 and centered, takes the middle square of the photo', () => {
    expect(cropRect(square, 300, { zoom: 1, x: 0, y: 0 })).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
    expect(cropRect(wide, 300, { zoom: 1, x: 0, y: 0 })).toEqual({ originX: 500, originY: 0, width: 1000, height: 1000 });
  });

  it('zooming in takes a smaller square from the middle', () => {
    expect(cropRect(square, 300, { zoom: 2, x: 0, y: 0 })).toEqual({ originX: 250, originY: 250, width: 500, height: 500 });
  });

  it('moving the photo right shows more of its left side, never past its edge', () => {
    // At zoom 1 the wide photo shows 600×300 points, so it can move 150 points either way.
    expect(cropRect(wide, 300, { zoom: 1, x: 150, y: 0 })).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
    expect(cropRect(wide, 300, { zoom: 1, x: 900, y: 40 })).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
  });

  it('keeps the zoom between 1 and the most, and the photo covering the circle', () => {
    expect(clampCrop(square, 300, { zoom: 0.5, x: 10, y: 0 })).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCrop(square, 300, { zoom: 9, x: 0, y: -2000 })).toEqual({ zoom: CROP_ZOOM_MAX, x: 0, y: -450 });
  });
});
