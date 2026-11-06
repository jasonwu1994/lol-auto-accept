import {expect, it} from 'vitest';
import {ignoreReducedMotionQuery} from './motionPreference';

it('reports no reduced-motion preference while leaving other queries untouched', () => {
  const target = {matchMedia: query => ({matches: query !== 'not all', media: query})};
  ignoreReducedMotionQuery(target);
  const reduced = target.matchMedia('(prefers-reduced-motion: reduce)');
  expect(reduced.matches).toBe(false);
  expect(reduced.media).toBe('(prefers-reduced-motion: reduce)');
  expect(target.matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
  const patched = target.matchMedia;
  ignoreReducedMotionQuery(target);
  expect(target.matchMedia).toBe(patched);
});
