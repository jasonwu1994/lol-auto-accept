import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import Layout from './Layout';
import GameReducer from '../redux/reducers/GameReducer';
import ConfigReducer from '../redux/reducers/ConfigReducer';
import i18n from '../i18n/i18n';

const fixture=vi.hoisted(()=>({recent:{loading:false,error:null,games:[]}}));
vi.mock('../hooks/useRecentMatches',()=>({default:()=>fixture.recent}));
vi.mock('./VisibleSwitch',()=>({default:()=>null}));
const render=(navOrder)=>renderToStaticMarkup(<Provider store={configureStore({reducer:()=>({GameReducer:GameReducer(undefined,{}),ConfigReducer:{...ConfigReducer(undefined,{}),...(navOrder?{navOrder}:{})}})})}>
  <MemoryRouter><Layout/></MemoryRouter></Provider>);

it('marks recent encounters whenever data exists, and clears the badge for empty or failed data',()=>{
  fixture.recent={loading:false,error:null,games:[{gameId:'one'},{gameId:'two'}]};
  expect(render()).toContain(i18n.t('layout.recentData',{count:2}));
  expect(render()).toContain('app-nav-data-badge');
  fixture.recent={loading:false,error:null,games:[]};
  expect(render()).not.toContain('app-nav-data-badge');
  fixture.recent={loading:false,error:Error('failed'),games:[{gameId:'old'}]};
  expect(render()).not.toContain('app-nav-data-badge');
});
it('renders navigation in the persisted order and exposes a labelled sorting entry',()=>{
  fixture.recent={loading:false,error:null,games:[]};
  const html=render(['/about','/recentPlayers','/duo','/main','/rank','/aram','/selectedRole']);
  expect(html.indexOf('href="/about"')).toBeLessThan(html.indexOf('href="/main"'));
  expect(html.indexOf('href="/recentPlayers"')).toBeLessThan(html.indexOf('href="/duo"'));
  expect(html).toContain(`aria-label="${i18n.t('layout.reorder')}"`);
});
