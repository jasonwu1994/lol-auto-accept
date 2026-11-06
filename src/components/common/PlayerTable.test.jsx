import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import PlayerTable, {PlayerIdentity} from './PlayerTable';
import Team from '../Team';
import DuoHistory from './DuoHistory';
import {copyPremadeGroup} from '../Duo';
import {desktop} from '../../desktop/tauri';
import i18n from '../../i18n/i18n';

vi.mock('../../hooks/useChampionData', () => ({default: () => {}}));
vi.mock('../../hooks/useSummonerName', () => ({usePlayerIdentity: player => ({name: player.gameName, recovered: player.rosterRecovered, loading: false})}));
vi.mock('../../api/api-utils', () => ({default: {
  getChampionNameById: id => id === 1 ? 'A' : 'Aurelion Sol',
  getSummonerByPuuidFromCache: async puuid => ({gameName: puuid === 'one' ? '玩家一' : '玩家二', tagLine: 'TW'}),
}}));
vi.mock('../../desktop/tauri', () => ({desktop: {invoke: vi.fn(async () => {})}}));

describe('player table', () => {
  it('omits the empty table frame when every team is absent',()=>{
    expect(renderToStaticMarkup(<PlayerTable>{false}{null}{[false,null]}</PlayerTable>)).toBe('');
  });
  it('shows numbered ally and opponent evidence beside the recovered name',()=>{
    const html=renderToStaticMarkup(<DuoHistory player={{needsHistory:true}} evidence={{status:'loaded',checked:5,rows:[
      {index:1,gameId:'50',encounters:[{puuid:'ally',championId:1,relation:'ally'},{puuid:'enemy',championId:2,relation:'enemy'}]},
      {index:3,gameId:'48',encounters:[{puuid:'ally',championId:1,relation:'enemy'}]},
    ]}}/>);
    expect(html).toContain('encounter-ally');
    expect(html).toContain('encounter-enemy');
    expect(html).toContain('>1.</span>');
    expect(html).toContain('>3.</span>');
    const visible = html.replace(/<[^>]*>/g,'');
    expect(visible).not.toContain(i18n.t('common.encounters.ally'));
    expect(visible).not.toContain(i18n.t('common.encounters.enemy'));
    expect(visible).toContain('Aurelion Sol');
    expect(html).toContain(i18n.t('common.encounters.allyDescription',{count:1}));
  });
  it('separates premade groups without adding blank table rows', () => {
    const team=[
      [{puuid:'one',championId:1,gameName:'One'}, {puuid:'two',championId:2,gameName:'Two'}],
      [{puuid:'three',championId:1,gameName:'Three'}],
    ];
    const html=renderToStaticMarkup(<PlayerTable><Team title="Blue" team={team}/></PlayerTable>);
    expect(html.match(/<tr[ >]/g)).toHaveLength(4);
    expect(html.match(/class="player-group-start"/g)).toHaveLength(1);
    expect(html).toContain('scope="row" rowSpan="2"');
    expect(html).toContain(`>${i18n.t('common.premade.duo')}</span>`);
    expect(html).toContain(`>${i18n.t('common.premade.solo')}</span>`);
    expect(html).not.toContain('player-group-divider');
  });
  it('shares one table across both teams with separate champion, ID, and value cells', () => {
    const html = renderToStaticMarkup(<PlayerTable>
      <Team title="Blue" team={[[{puuid:'one',championId:1,gameName:'PlayerOne#TW',selectedPosition:'TOP'}]]}/>
      <Team title="Red" team={[[{puuid:'two',championId:2,gameName:'中文玩家#TW',selectedPosition:'MIDDLE'}]]}/>
    </PlayerTable>);
    expect(html.match(/<table /g)).toHaveLength(1);
    expect(html.match(/<tbody>/g)).toHaveLength(2);
    expect(html).toContain('<td>A</td><td><span>PlayerOne#TW</span></td><td>TOP</td>');
    expect(html).toContain('<td>Aurelion Sol</td><td><span>中文玩家#TW</span></td><td>MIDDLE</td>');
    expect(html).toContain('tabindex="0"');
  });

  it('labels only players recovered from missing roster entries', () => {
    const recovered = renderToStaticMarkup(<PlayerIdentity player={{gameName:'Found#TW',rosterRecovered:true}}/>);
    const original = renderToStaticMarkup(<PlayerIdentity player={{gameName:'Known#TW'}}/>);
    expect(recovered).toContain(i18n.t('common.recoveredName'));
    expect(original).not.toContain('player-name-recovered');
  });

  it('does not call an incomplete roster all solo', () => {
    const html = renderToStaticMarkup(<PlayerTable><Team title="Blue" incomplete team={[[{puuid:'one',gameName:'One',championId:1}]]}/></PlayerTable>);
    expect(html).toContain(`Blue(${i18n.t('common.premade.unknown')})`);
    expect(html).not.toContain(`Blue(${i18n.t('common.premade.solo')})`);
  });
  it('makes each premade player name a keyboard-accessible copy control', () => {
    const group=[{puuid:'one',championId:1,gameName:'One#TW'}, {puuid:'two',championId:2,gameName:'Two#TW'}];
    const html=renderToStaticMarkup(<PlayerTable><Team title="Blue" team={[group]} onCopyGroup={()=>{}}/></PlayerTable>);
    expect(html.match(/<button type="button" class="player-copy-name"/g)).toHaveLength(4);
    expect(html).toContain(i18n.t('common.copyPremade'));
    expect(html).toContain('<span>One#TW</span></button>');
    expect(html).toContain('<span>Two#TW</span></button>');
    expect(html).toContain('>A</button>');
    expect(html).toContain('>Aurelion Sol</button>');
  });
  it('writes resolved group names and champion names to the native clipboard', async () => {
    await copyPremadeGroup([
      {puuid:'one',championId:1},
      {puuid:'two',championId:2},
    ],i18n.getFixedT('zh'));
    expect(desktop.invoke).toHaveBeenCalledWith('write_clipboard', {
      text:'雙排\nA 玩家一#TW\nAurelion Sol 玩家二#TW',
    });
  });
});
