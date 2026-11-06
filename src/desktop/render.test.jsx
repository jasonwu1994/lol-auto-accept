import Duo from '../components/Duo';
import Rank from '../components/Rank';
import SelectedRole from '../components/SelectedRole';
import RecentPlayers from '../components/RecentPlayers';
import {configureStore} from '@reduxjs/toolkit';
import i18n from '../i18n/i18n';
import ChampionsPick from '../components/ARAM/ChampionsPick';
import GameDataStatus from '../components/common/GameDataStatus';
import RecentTeammates from '../components/main/RecentTeammates';
import React from 'react';
import {it,expect} from 'vitest';
import {renderToString} from 'react-dom/server';
import {Provider} from 'react-redux';
import {MemoryRouter} from 'react-router-dom';
import Layout from '../components/Layout';
import ThemeProvider from '../theme';
import store from '../redux/store';
import '../i18n/i18n';
it('renders every retained page with disconnected data without Node or Electron globals',()=>{
  const html=renderToString(<Provider store={store}><MemoryRouter initialEntries={['/main']}><ThemeProvider><Layout/></ThemeProvider></MemoryRouter></Provider>);
  expect(html).toContain('auto-accept-btn');
  expect(html).toContain('auto-aram-topmost-btn');
  expect(html).toContain(i18n.t('main.autoAramTopmost'));
  expect(html).not.toContain('hovercard-preview');
  for (const id of ['hovercard-btn','hovercard-ranked-select','hovercard-tier-select','recent-encounters-title','hidden-player-history-title']) {
    expect(html).toContain(`id="${id}"`);
  }
  const pick=renderToString(<Provider store={store}><ThemeProvider><ChampionsPick/></ThemeProvider></Provider>);
  expect(pick).toContain('always-on-top-btn');
  expect(html).not.toContain('type="file"');
  expect(html).not.toContain('NaN');
});
it('places the hidden-player toggle after recent teammates with a five-game default and ten-game maximum',()=>{
  const render=config=>renderToString(<Provider store={configureStore({reducer:()=>({...store.getState(),ConfigReducer:config})})}><ThemeProvider><RecentTeammates/></ThemeProvider></Provider>);
  const config=store.getState().ConfigReducer;
  const html=render(config);
  expect(html.indexOf('hidden-player-history-btn')).toBeGreaterThan(html.indexOf('recent-teammate-count-label'));
  const sliders=html.match(/<input[^>]*type="range"[^>]*>/g) ?? [];
  const slider=sliders.at(-1);
  expect(slider).toContain('max="10"');
  expect(slider).toContain('value="5"');
  const disabled=render({...config,isCheckHiddenPlayerHistory:false});
  const disabledSlider=(disabled.match(/<input[^>]*type="range"[^>]*>/g) ?? []).at(-1);
  expect(disabledSlider).toContain('disabled=""');
});

it('data pages stay visually empty while disconnected, including ARAM pick',()=>{
  for(const Page of [Duo,Rank,SelectedRole,RecentPlayers]) {
    const html=renderToString(<Provider store={store}><ThemeProvider><Page/></ThemeProvider></Provider>);
    expect(html).not.toContain(i18n.t('common.clientDisconnected'));
    expect(html).not.toContain('player-table-scroll');
  }
  const pick=renderToString(<Provider store={store}><ThemeProvider><ChampionsPick/></ThemeProvider></Provider>);
  expect(pick).not.toContain(i18n.t('common.noChampSelectData'));
});
it('shows no empty-state artwork or copy when connected without data',()=>{
  const state={...store.getState(),AuthReducer:{connection:'Connected'}};
  const html=renderToString(<Provider store={configureStore({reducer:()=>state})}><ThemeProvider><GameDataStatus/></ThemeProvider></Provider>);
  expect(html).toBe('');
});
it('keeps players visible when role information is unknown',()=>{
  const state={...store.getState(),AuthReducer:{connection:'Connected'},GameReducer:{...store.getState().GameReducer,gameflowSession:{gameData:{teamOne:[{puuid:'fixture-player',championId:1}],teamTwo:[]}}}};
  const connected=configureStore({reducer:()=>state});
  const html=renderToString(<Provider store={connected}><ThemeProvider><SelectedRole/></ThemeProvider></Provider>);
  expect(html).toContain(i18n.t('common.unknown'));
  expect(html).toContain('data-champion-id="1"');
});
it('keeps ranked tabs above the loading message while stats are being fetched',()=>{
  const state={...store.getState(),AuthReducer:{connection:'Connected'},GameReducer:{...store.getState().GameReducer,
    gameflowSession:{gameData:{gameId:'loader-order',teamOne:[{puuid:'rank-loader-player',summonerId:'123'}]}}}};
  const html=renderToString(<Provider store={configureStore({reducer:()=>state})}><ThemeProvider><Rank/></ThemeProvider></Provider>);
  expect(html.indexOf('role="tablist"')).toBeGreaterThan(-1);
  expect(html.indexOf('role="status"')).toBeGreaterThan(html.indexOf('role="tablist"'));
});

it('keeps manual accept and decline buttons enabled outside ReadyCheck',()=>{
  const html=renderToString(<Provider store={store}><MemoryRouter initialEntries={['/main']}><ThemeProvider><Layout/></ThemeProvider></MemoryRouter></Provider>);
  const buttons=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  for (const key of ['main.acceptMatchmaking','main.declineMatchmaking']) {
    const button=buttons.find(markup=>markup.includes(i18n.t(key)));
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled');
  }
});
