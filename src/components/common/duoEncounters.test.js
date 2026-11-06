import {describe, expect, it, vi} from 'vitest';
import {encounterRows, idleEvidence, loadDuoEncounters, loadPlayerEncounters, prepareDuoRoster} from './duoEncounters';
import {groupCurrentTeam} from './premade';

const match = (id, sides) => ({gameId:id, participantIdentities:sides.map(([puuid],i)=>({participantId:i+1,player:{puuid}})),
  participants:sides.map(([,teamId],i)=>({participantId:i+1,teamId}))});

describe('hidden-player recent encounters',()=>{
  it('uses the selected ten-game limit for both the API and detail downloads',async()=>{
    const api={getSummonerByPuuidFromCache:async()=>({}),
      getPlayerMatches:vi.fn(async()=>({games:{games:Array.from({length:12},(_,i)=>({gameId:String(100-i)}))}})),
      getEncounterGame:vi.fn(async id=>match(id,[['subject',100],['mate',200]]))};
    const assertCurrent=()=>{};
    const result=await loadPlayerEncounters({puuid:'subject'},[{puuid:'mate',championId:1}],null,api,assertCurrent,10);
    expect(api.getPlayerMatches).toHaveBeenCalledWith('subject',10,assertCurrent);
    expect(api.getEncounterGame).toHaveBeenCalledTimes(10);
    expect(result.rows.at(-1).index).toBe(10);
  });
  it('does not query histories or show loading badges when the setting is disabled',async()=>{
    const roster={teamOne:[{puuid:'subject',championId:1,nameHidden:true}],teamTwo:[],unassigned:[]};
    const api={getLivePlayers:async()=>[],getAllChampionsByCache:async()=>[],getPlayerMatches:vi.fn()};
    const result=await loadDuoEncounters('history-disabled',roster,'100',api,()=>{},false,5,false);
    expect(api.getPlayerMatches).not.toHaveBeenCalled();
    expect(result.evidence).toEqual({});
    expect(result.roster.teamOne[0]).toMatchObject({needsHistory:false,groupUnknown:true});
  });
  it('compares only current teammates even when a current opponent was a historical ally',async()=>{
    const roster={teamOne:[{puuid:'current-opponent',championId:1,teamParticipantId:4}],
      teamTwo:[{puuid:'subject',championId:2,nameHidden:true,teamParticipantId:5},{puuid:'current-mate',championId:3,teamParticipantId:6}],unassigned:[]};
    const api={getLivePlayers:async()=>[],getAllChampionsByCache:async()=>[],getSummonerByPuuidFromCache:async()=>({gameName:'Found'}),
      getPlayerMatches:async()=>({games:{games:[{gameId:'50'}]}}),
      getEncounterGame:async()=>match('50',[['subject',100],['current-mate',200],['current-opponent',100]])};
    const result=await loadDuoEncounters('current-teammate-scope',roster,'100',api,()=>{});
    expect(result.evidence.subject.rows[0].encounters).toEqual([{puuid:'current-mate',championId:3,relation:'enemy'}]);
    expect(result.roster.teamTwo[0].teamParticipantId).toBe(5);
    expect(result.roster.teamTwo[0].groupUnknown).toBe(false);
  });
  it('distinguishes allies and opponents using exact PUUID and historical teams while naming current champions',()=>{
    const teammates=[{puuid:'subject',championId:1},{puuid:'ally',championId:89},{puuid:'enemy',championId:63}];
    const rows=encounterRows('subject',teammates,[
      {index:1,game:match('10',[['subject',200],['ally',200],['enemy',100]])},
      {index:2,game:match('9',[['subject',100],['ally',200]])},
    ]);
    expect(rows.map(row=>[row.index,row.encounters])).toEqual([
      [1,[{puuid:'ally',championId:89,relation:'ally'},{puuid:'enemy',championId:63,relation:'enemy'}]],
      [2,[{puuid:'ally',championId:89,relation:'enemy'}]],
    ]);
    expect(encounterRows('absent',teammates,[{index:1,game:match('1',[['ally',100]])}])).toEqual([]);
  });

  it('recovers a missing team only from an unambiguous live champion without inventing premade membership',()=>{
    const hidden={puuid:'hidden',championId:134,rosterRecovered:true,groupUnknown:true};
    const roster={teamOne:[{puuid:'blue',championId:89,teamParticipantId:1}],teamTwo:[{puuid:'red',championId:63,teamParticipantId:2}],unassigned:[hidden]};
    const champions=[{key:'134',id:'Syndra'},{key:'89',id:'Leona'},{key:'63',id:'Brand'}];
    const prepared=prepareDuoRoster(roster,[{championKey:'Syndra',team:'CHAOS',nameHidden:true}],champions);
    expect(prepared.unassigned).toEqual([]);
    expect(prepared.teamTwo[1]).toMatchObject({puuid:'hidden',needsHistory:true,groupUnknown:true});
    expect(groupCurrentTeam(prepared.teamTwo).find(group=>group[0].puuid==='hidden')[0].groupUnknown).toBe(true);
    expect(hidden).not.toHaveProperty('soloFallback');
    const ambiguous=prepareDuoRoster({...roster,teamOne:[{puuid:'other',championId:134}]},[{championKey:'Syndra',team:'CHAOS',nameHidden:true}],champions);
    expect(ambiguous.unassigned).toHaveLength(1);
  });

  it('reads exactly five completed games and keeps the original history index when one detail request fails',async()=>{
    const api={getSummonerByPuuidFromCache:vi.fn(async()=>({gameName:'Name'})),
      getPlayerMatches:vi.fn(async()=>({games:{games:['current','10','9','8','7','6','5'].map(gameId=>({gameId}))}})),
      getEncounterGame:vi.fn(async id=>{if(id==='9')throw Error('unavailable');return match(id,[['subject',100],['mate',200]]);})};
    const result=await loadPlayerEncounters({puuid:'subject'},[{puuid:'mate',championId:89}], 'current',api);
    expect(api.getEncounterGame.mock.calls.map(([id])=>id)).toEqual(['10','9','8','7','6']);
    expect(result.status).toBe('partial');
    expect(result.checked).toBe(4);
    expect(result.rows.map(row=>row.index)).toEqual([1,3,4,5]);
  });

  it('stops old-session work before downloading another game and does not treat invalid history as no encounters',async()=>{
    let changed=false;
    const api={getSummonerByPuuidFromCache:async()=>({}),getPlayerMatches:async()=>({games:{games:[{gameId:'1'},{gameId:'2'}]}}),
      getEncounterGame:vi.fn(async()=>{changed=true;return match('1',[['subject',100]]);})};
    await expect(loadPlayerEncounters({puuid:'subject'},[],null,api,()=>{if(changed)throw Error('changed');})).rejects.toThrow('changed');
    expect(api.getEncounterGame).toHaveBeenCalledOnce();
    api.getPlayerMatches=async()=>({});
    await expect(loadPlayerEncounters({puuid:'subject'},[],null,api)).rejects.toThrow('unavailable');
  });
});

describe('when no lookup can run, for example right after the app opens',()=>{
  it('settles players needing history instead of leaving them loading',()=>{
    const roster={
      teamOne:[{puuid:'hidden-ally',needsHistory:true},{puuid:'visible',needsHistory:false}],
      teamTwo:[{puuid:'asked',needsHistory:true}],
      unassigned:[{puuid:'unknown-side',needsHistory:true,rosterRecovered:true}],
    };
    const loaded={status:'loaded',checked:5,rows:[]};
    const evidence=idleEvidence(roster,{asked:loaded});
    expect(evidence['unknown-side']).toEqual({status:'unknownTeam',rows:[]});
    expect(evidence['hidden-ally']).toEqual({status:'skipped',rows:[]});
    expect(evidence.asked).toBe(loaded);
    expect(evidence.visible).toBeUndefined();
    expect(Object.keys(idleEvidence(roster))).toHaveLength(3);
    expect(idleEvidence({teamOne:[],teamTwo:[],unassigned:[]})).toEqual({});
  });
});
