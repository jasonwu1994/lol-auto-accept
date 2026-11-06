import {it,expect} from 'vitest';
import {isNewerVersion} from './versions';
it('compares validated semver including prerelease ordering and build metadata',()=>{
  expect(isNewerVersion('1.5.2','v1.5.3')).toBe(true);
  expect(isNewerVersion('1.5.2','1.5.2-beta')).toBe(false);
  expect(isNewerVersion('1.5.2-beta.2','1.5.2-beta.10')).toBe(true);
  expect(isNewerVersion('1.5.2-beta.10','1.5.2')).toBe(true);
  expect(isNewerVersion('1.5.2+one','1.5.2+two')).toBe(false);
  expect(isNewerVersion('1.5.2','not-a-version')).toBe(null);
  expect(isNewerVersion('1.5.2','1.05.3')).toBe(null);
  expect(isNewerVersion('1.5.2','1.5.3-beta.01')).toBe(null);
});
