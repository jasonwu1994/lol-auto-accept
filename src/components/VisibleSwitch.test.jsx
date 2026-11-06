import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import VisibleSwitch from './VisibleSwitch';

const rendered = vi.hoisted(() => []);
vi.mock('./Main', () => ({default: () => {rendered.push('main'); return 'main';}}));
vi.mock('./Duo', () => ({default: () => {rendered.push('duo'); return 'duo';}}));
vi.mock('./Rank', () => ({default: () => {rendered.push('rank'); return 'rank';}}));
vi.mock('./RecentPlayers', () => ({default: () => {rendered.push('recentPlayers'); return 'recentPlayers';}}));
vi.mock('./ARAM', () => ({default: () => {rendered.push('aram'); return 'aram';}}));
vi.mock('./SelectedRole', () => ({default: () => {rendered.push('selectedRole'); return 'selectedRole';}}));
vi.mock('./About', () => ({default: () => {rendered.push('about'); return 'about';}}));

describe('visible page lifecycle', () => {
  it.each(['main', 'duo', 'rank', 'recentPlayers', 'aram', 'selectedRole', 'about'])('renders only the %s route', path => {
    rendered.length = 0;
    renderToStaticMarkup(<MemoryRouter initialEntries={[`/${path}`]}><VisibleSwitch/></MemoryRouter>);
    expect(rendered).toEqual([path]);
  });

  it('does not mistake a route substring for an active page', () => {
    rendered.length = 0;
    renderToStaticMarkup(<MemoryRouter initialEntries={['/mainly']}><VisibleSwitch/></MemoryRouter>);
    expect(rendered).toEqual([]);
  });
});
