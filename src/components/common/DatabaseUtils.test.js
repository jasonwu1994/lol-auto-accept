import {it,expect,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn(async()=>[]));
vi.mock('../../desktop/tauri',()=>({desktop:{invoke}}));
import DatabaseUtils from './DatabaseUtils';
it('passes an explicit display limit while keeping cache lookups broader',async()=>{
  await DatabaseUtils.getAllGamesByOwnerPuuid('fixture-owner',20);
  expect(invoke).toHaveBeenLastCalledWith('history_list_games',{ownerPuuid:'fixture-owner',limit:20});
  await DatabaseUtils.getAllGamesByOwnerPuuid('fixture-owner',5);
  expect(invoke).toHaveBeenLastCalledWith('history_list_games',{ownerPuuid:'fixture-owner',limit:5});
  await DatabaseUtils.getAllGamesByOwnerPuuid('fixture-owner');
  expect(invoke).toHaveBeenLastCalledWith('history_list_games',{ownerPuuid:'fixture-owner',limit:1000});
});

it('checks only requested owner game IDs without loading historical payloads',async()=>{
  const gameIds=['9007199254740993','42'];
  invoke.mockResolvedValueOnce(['9007199254740993']);
  const existing=await DatabaseUtils.getExistingGameIds('fixture-owner',gameIds);
  expect(invoke).toHaveBeenLastCalledWith('history_existing_game_ids',{ownerPuuid:'fixture-owner',gameIds});
  expect(existing).toEqual(['9007199254740993']);
});
