import React from 'react';
import {it, expect, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import ChampionsPick from './ChampionsPick';
import store from '../../redux/store';
import i18n from '../../i18n/i18n';

vi.mock('../../hooks/useChampionData', () => ({default: () => {}}));
vi.mock('../common/ChampionImage', () => ({default: ({championId}) => <span>champion:{championId}</span>}));
vi.mock('../../api/api-utils', () => ({default: {getCachedSummoner: () => undefined, getChampionNameById: id => `Champion ${id}`}}));

it('renders champion rows immediately while player identities are still loading', () => {
  const state = {...store.getState(), AuthReducer: {connection: 'Connected'}, GameReducer: {
    ...store.getState().GameReducer,
    gamePhase: 'ChampSelect',
    champSelectSession: {benchEnabled: true},
    myTeam: [{cellId: 0, puuid: 'player-one', summonerId: '123', championId: 1}]
  }};
  const html = renderToStaticMarkup(<Provider store={configureStore({reducer: () => state})}><ChampionsPick/></Provider>);
  expect(html).toContain('Champion 1');
  expect(html).toContain('champion:1');
  expect(html).toContain('role="grid"');
});

it('does not render an empty-state block or image outside champion selection', () => {
  const state = {...store.getState(), AuthReducer: {connection: 'Connected'}, GameReducer: {
    ...store.getState().GameReducer,
    gamePhase: 'Lobby', champSelectSession: {}, myTeam: []
  }};
  const html = renderToStaticMarkup(<Provider store={configureStore({reducer: () => state})}><ChampionsPick/></Provider>);
  expect(html).not.toContain(i18n.t('common.noChampSelectData'));
  expect(html).not.toContain('role="grid"');
  expect(html).not.toContain('<img');
});

it('lists bench portraits once and keeps swaps disabled until eligibility has been read', () => {
  const state = {...store.getState(), AuthReducer: {connection: 'Connected'}, GameReducer: {
    ...store.getState().GameReducer,
    gamePhase: 'ChampSelect',
    champSelectSession: {benchEnabled: true, benchChampions: [{championId: 3}, {championId: 4}, {championId: 3}]},
    myTeam: []
  }};
  const render = game => renderToStaticMarkup(<Provider store={configureStore({reducer: () => ({...state, GameReducer: game})})}><ChampionsPick/></Provider>);
  const html = render(state.GameReducer);
  expect(html).toContain(i18n.t('aram.benchTitle'));
  for (const id of [3, 4]) {
    expect(html.match(new RegExp(`champion:${id}`, 'g'))).toHaveLength(1);
    expect(html).toContain(`aria-label="${i18n.t('aram.swapChampion', {champion: `Champion ${id}`})}"`);
  }
  expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  const retained = render({...state.GameReducer, gamePhase: 'InProgress'});
  expect(retained).toContain('champion:3');
  expect(retained.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
});
