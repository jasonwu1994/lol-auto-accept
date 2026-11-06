export const DEFAULT_NAV_ORDER = Object.freeze(['/main','/duo','/rank','/recentPlayers','/aram','/selectedRole','/about']);

export function normalizeNavOrder(saved) {
  const known = Array.isArray(saved) ? saved.filter(path => DEFAULT_NAV_ORDER.includes(path)) : [];
  return [...new Set([...known, ...DEFAULT_NAV_ORDER])];
}

export function moveNavItem(order, source, target, placement = 'before') {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter(path => path !== source);
  next.splice(next.indexOf(target) + (placement === 'after' ? 1 : 0), 0, source);
  return next;
}

export function navDragLayout(fromIndex, count, pointerOffset, step) {
  const offset = Math.max(-fromIndex * step, Math.min((count - 1 - fromIndex) * step, pointerOffset));
  const toIndex = Math.max(0, Math.min(count - 1, Math.round(fromIndex + offset / step)));
  const offsets = Array.from({length:count}, (_, index) => {
    if (index === fromIndex) return offset;
    if (toIndex < fromIndex && index >= toIndex && index < fromIndex) return step;
    if (toIndex > fromIndex && index > fromIndex && index <= toIndex) return -step;
    return 0;
  });
  return {offset,toIndex,offsets};
}
