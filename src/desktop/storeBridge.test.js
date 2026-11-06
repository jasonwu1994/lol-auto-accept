import {it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({dispatch:vi.fn(),config:{language:'zh'},i18n:{language:'zh',changeLanguage:vi.fn()}}));
vi.mock('../redux/store',()=>({default:{dispatch:fixture.dispatch,getState:()=>({ConfigReducer:fixture.config})}}));
vi.mock('../i18n/i18n',()=>({default:fixture.i18n,translate:key=>key}));
vi.mock('../api/api-utils',()=>({default:{getChampionNameById:id=>String(id)}}));
import {applySnapshot} from './storeBridge';
it('does not dispatch or emit language changes for repeated disconnected snapshots',()=>{
  fixture.dispatch.mockImplementation(action=>{if(action.type==='change-config')fixture.config=action.data;});
  const snapshot={configRevision:0,config:{language:'zh'},connection:'Disconnected',phase:'None',gameflowSession:null,champSelectSession:null,lobbyMembers:null,aramPreferences:[]};
  applySnapshot(snapshot);
  const count=fixture.dispatch.mock.calls.length;
  applySnapshot(structuredClone(snapshot));
  expect(fixture.dispatch).toHaveBeenCalledTimes(count);
  expect(fixture.i18n.changeLanguage).not.toHaveBeenCalled();
  applySnapshot({...snapshot,configRevision:1,config:{language:'en'}});
  expect(fixture.i18n.changeLanguage).toHaveBeenCalledWith('en');
  expect(fixture.dispatch.mock.calls.slice(count).map(([action])=>action.type)).toContain('change-appState');
});
