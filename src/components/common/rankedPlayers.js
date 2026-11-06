import {hasPlayerId} from '../../desktop/identifiers';
export async function enrichRankedPlayers(team,lookup) {
  return Promise.all((team ?? []).map(async player=>{
    if(!hasPlayerId(player.summonerId)) return {...player,rankedStats:null};
    try {return {...player,rankedStats:await lookup(player.summonerId)};}
    catch {return {...player,rankedStats:null};}
  }));
}
