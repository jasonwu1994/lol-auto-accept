export function orderBalanceRows(rows,session) {
  if(!Array.isArray(rows))return [];
  const team=[...(session?.myTeam ?? [])].sort((a,b)=>a.cellId-b.cellId);
  const ids=[...new Set([...team,...(session?.benchChampions ?? [])].map(player=>player.championId).filter(id=>id>0))];
  const priority=new Map(ids.map((id,index)=>[id,index]));
  return [...rows].sort((a,b)=>(priority.get(a.champion_id) ?? ids.length)-(priority.get(b.champion_id) ?? ids.length));
}
