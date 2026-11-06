import {describe,it,expect} from 'vitest';
import {formatPremadeGroup, groupCurrentTeam} from './premade';
import i18n from '../../i18n/i18n';
describe('current-match premades',()=>{
  it('uses teamParticipantId within each team and keeps missing values unknown',()=>{
    const players=[{puuid:'a',teamParticipantId:1},{puuid:'b',teamParticipantId:1},{puuid:'c'},{puuid:'d',teamParticipantId:null},{puuid:'e',teamParticipantId:2}];
    const groups=groupCurrentTeam(players);
    expect(groups.map(group=>group.length)).toEqual([2,1,1,1]);
    expect(groups.slice(2).every(group=>group[0].groupUnknown)).toBe(true);
    expect(players[2]).not.toHaveProperty('groupUnknown');
    expect(groupCurrentTeam([{teamParticipantId:1}])).toHaveLength(1);
    expect(groupCurrentTeam()).toEqual([]);
    const blue=groupCurrentTeam([{puuid:'blue1',teamParticipantId:7},{puuid:'blue2',teamParticipantId:7}]);
    const red=groupCurrentTeam([{puuid:'red1',teamParticipantId:7}]);
    expect(blue[0]).toHaveLength(2);expect(red[0]).toHaveLength(1);
    expect(groupCurrentTeam([{teamParticipantId:0},{teamParticipantId:0}])[0]).toHaveLength(2);
    expect(groupCurrentTeam([{teamParticipantId:''},{teamParticipantId:''}])).toHaveLength(2);
  });
  it('copies only the selected current-match duo or trio with champions and full player names',()=>{
    const players=[
      {teamParticipantId:1,championName:'阿璃',name:'玩家一#TW'},
      {teamParticipantId:1,championName:'蓋倫',name:'玩家二#TW'},
      {teamParticipantId:2,championName:'拉克絲',name:'玩家三#TW'},
      {teamParticipantId:2,championName:'索娜',name:'玩家四#TW'},
      {teamParticipantId:2,championName:'凱特琳',name:'玩家五#TW'},
    ];
    const groups=groupCurrentTeam(players);
    const t=i18n.getFixedT('zh');
    expect(formatPremadeGroup(groups.find(group=>group.includes(players[0])),t))
      .toBe('雙排\n阿璃 玩家一#TW\n蓋倫 玩家二#TW');
    expect(formatPremadeGroup(groups.find(group=>group.includes(players[3])),t))
      .toBe('三排\n拉克絲 玩家三#TW\n索娜 玩家四#TW\n凱特琳 玩家五#TW');
  });
  it('keeps missing group data unknown in copied text',()=>{
    const group=groupCurrentTeam([{championName:'阿璃',name:'玩家#TW'}])[0];
    expect(formatPremadeGroup(group,i18n.getFixedT('zh'))).toBe('未知\n阿璃 玩家#TW');
  });
});

it('moves history matches beside the strongest current teammate without merging party or copy membership',()=>{
 const players=[{puuid:'a',teamParticipantId:1},{puuid:'locke',teamParticipantId:2},{puuid:'b',teamParticipantId:3},{puuid:'teemo',groupUnknown:true}];
 const ids=groups=>groups.map(g=>g.map(p=>p.puuid));
 expect(ids(groupCurrentTeam(players))).toEqual([['a'],['locke'],['b'],['teemo']]);
 const evidence={teemo:{rows:[{encounters:[{puuid:'a'},{puuid:'locke'},{puuid:'locke'}]},{encounters:[{puuid:'locke'},{puuid:'opponent'}]}]}};
 const groups=groupCurrentTeam(players,evidence);
 expect(ids(groups)).toEqual([['a'],['locke'],['teemo'],['b']]);
 expect(groups[2][0].groupUnknown).toBe(true);
 expect(groups[2][0]).not.toHaveProperty('teamParticipantId');
 expect(ids(groupCurrentTeam(players,{teemo:{rows:[]}}))).toEqual([['a'],['locke'],['b'],['teemo']]);
});
