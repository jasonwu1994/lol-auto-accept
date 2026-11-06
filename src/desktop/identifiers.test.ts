import {it,expect,vi} from 'vitest';
import {decimalId,hasPlayerId} from './identifiers';
const invoke=vi.hoisted(()=>vi.fn(async()=>[]));
vi.mock('./tauri',()=>({desktop:{invoke,session:()=>({connectionGeneration:1,sessionKey:'fixture'})}}));
import ApiUtils from '../api/api-utils';
it('preserves large identifiers exactly and refuses already-rounded numeric input',async()=>{
  const large='9007199254740993';
  expect(decimalId(large)).toBe(large);
  expect(hasPlayerId(large)).toBe(true);
  expect(hasPlayerId('0')).toBe(false);
  expect(hasPlayerId(0)).toBe(false);
  expect(hasPlayerId(null)).toBe(false);
  expect(()=>decimalId(Number(large))).toThrow('Unsafe');
  expect(()=>decimalId('18446744073709551616')).toThrow('Invalid');
  await ApiUtils.getSummonersById(large);
  expect(invoke).toHaveBeenLastCalledWith('get_summoners_by_id',{summonerId:large});
  await ApiUtils.getRankedStats(large);
  expect(invoke).toHaveBeenLastCalledWith('get_ranked_stats',{summonerId:large});
  await ApiUtils.getHistoryGame(large);
  expect(invoke).toHaveBeenLastCalledWith('get_history_game',{gameId:large});
  await expect(ApiUtils.getHistoryGame(Number(large))).rejects.toThrow('Unsafe');
});

it('manual ready-check actions keep the session of the rendered view',async()=>{
  const intent={connectionGeneration:4,sessionKey:'old-visible-session'};
  await ApiUtils.postAcceptMatchmaking(intent);
  expect(invoke).toHaveBeenLastCalledWith('respond_ready_check',{action:'accept',...intent});
  await ApiUtils.postDeclineMatchmaking(intent);
  expect(invoke).toHaveBeenLastCalledWith('respond_ready_check',{action:'decline',...intent});
});
