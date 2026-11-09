/// <reference types="node" />
// Every number pad gets iOS's own Done (T214): React Native 0.88 adds a toolbar with one Done button to a number-pad
// box that sets returnKeyType and has no inputAccessoryViewID (RCTTextInputComponentView's
// setDefaultInputAccessoryView). Kept's own Done bar showed beside Next and never reached boxes that appeared later,
// so it's gone, and this checks every box keeps a way to close its keyboard.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('number pads (T214)', () => {
  const root = join(__dirname, '..');
  const inputs = [...sources(join(root, 'app')), ...sources(join(root, 'components'))].flatMap((file) =>
    (readFileSync(file, 'utf8').match(/<TextInput\b[\s\S]*?\/>/g) ?? []).map((tag) => ({ file: file.slice(root.length + 1), tag })),
  );
  // A one-time code box checks itself at the last digit, under iOS's own code suggestion: it needs no Done.
  const numberPads = inputs.filter(({ tag }) => /keyboardType="(number-pad|decimal-pad|phone-pad)"/.test(tag) && !/oneTimeCode/.test(tag));

  it('finds the number boxes (stake, pledge, gift, length, tracker goal)', () => {
    expect(numberPads.length).toBeGreaterThanOrEqual(3);
  });

  it('each sets returnKeyType, so iOS adds its Done above the keyboard', () => {
    expect(numberPads.filter(({ tag }) => !/returnKeyType=/.test(tag)).map(({ file }) => file)).toEqual([]);
  });

  it('none points at a custom accessory bar, which would hide that Done', () => {
    expect(inputs.filter(({ tag }) => /inputAccessoryViewID=/.test(tag)).map(({ file }) => file)).toEqual([]);
  });
});
