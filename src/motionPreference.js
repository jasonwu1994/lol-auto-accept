// The app does not follow the system "reduce motion" setting. CSS blocks are removed at build time;
// this makes runtime checks (e.g. toast exit animations) see "no reduced-motion preference" too.
export function ignoreReducedMotionQuery(target = globalThis.window) {
  if (!target || typeof target.matchMedia !== 'function' || target.matchMedia.ignoresReducedMotion) return;
  const native = target.matchMedia.bind(target);
  const patched = query => /prefers-reduced-motion\s*:\s*reduce/i.test(String(query))
    ? Object.defineProperty(native('not all'), 'media', {value: String(query)})
    : native(query);
  patched.ignoresReducedMotion = true;
  target.matchMedia = patched;
}
ignoreReducedMotionQuery();
