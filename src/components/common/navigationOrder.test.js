import {expect,it} from 'vitest';
import {DEFAULT_NAV_ORDER,moveNavItem,navDragLayout,normalizeNavOrder} from './navigationOrder';

it('retains saved routes once and appends missing routes when an older setting is loaded',()=>{
  expect(normalizeNavOrder(['/about','/duo','/about','/removed']))
    .toEqual(['/about','/duo','/main','/rank','/recentPlayers','/aram','/selectedRole']);
  expect(normalizeNavOrder(null)).toEqual(DEFAULT_NAV_ORDER);
});
it('slides only the crossed rows aside while the dragged row follows its pointer',()=>{
  expect(navDragLayout(3,7,-90,42)).toEqual({offset:-90,toIndex:1,offsets:[0,42,42,-90,0,0,0]});
  expect(navDragLayout(1,7,130,42)).toEqual({offset:130,toIndex:4,offsets:[0,130,-42,-42,-42,0,0]});
});
it('keeps drag slots inside the list and crosses a slot only after its midpoint',()=>{
  expect(navDragLayout(3,7,-1000,42)).toMatchObject({offset:-126,toIndex:0});
  expect(navDragLayout(3,7,1000,42)).toMatchObject({offset:126,toIndex:6});
  expect(navDragLayout(1,7,20,42).toIndex).toBe(1);
  expect(navDragLayout(1,7,22,42).toIndex).toBe(2);
});
it('moves routes both upward and downward without losing, duplicating, or mutating pages',()=>{
  const before=[...DEFAULT_NAV_ORDER];
  expect(moveNavItem(before,'/about','/main')).toEqual(['/about',...before.slice(0,-1)]);
  expect(moveNavItem(before,'/main','/about','after')).toEqual([...before.slice(1),'/main']);
  expect(moveNavItem(before,'/missing','/about')).toBe(before);
  expect(before).toEqual(DEFAULT_NAV_ORDER);
});
