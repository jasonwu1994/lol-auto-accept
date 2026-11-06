import {hasPlayerId} from '../../desktop/identifiers';
const text = value => typeof value === 'string' ? value.trim() : '';

export function playerName(player) {
  const gameName = text(player?.gameName) || text(player?.riotIdGameName);
  const tag = text(player?.tagLine) || text(player?.riotIdTagLine);
  if (gameName) return tag ? `${gameName}#${tag}` : gameName;
  return text(player?.summonerName) || text(player?.displayName) || text(player?.internalName) || text(player?.summonerInternalName);
}

export function initialPlayerIdentity(player) {
  return {name: playerName(player), recovered: Boolean(player?.rosterRecovered), loading: false};
}

export function hasPuuid(player) {
  return typeof player?.puuid === 'string' && player.puuid.length > 0 && !/^0+(?:-0+)*$/.test(player.puuid);
}

export async function resolvePlayerIdentity(player, lookup, lookupById) {
  const initial = initialPlayerIdentity(player);
  if (!hasPuuid(player) && (!lookupById || !hasPlayerId(player?.summonerId))) return initial;
  try {
    const summoner = hasPuuid(player) ? await lookup(player.puuid) : (await lookupById(player.summonerId))?.[0];
    const name = playerName(summoner);
    return {...initial, name: name || initial.name};
  } catch {
    return initial;
  }
}
// Keep resolved display names available when the client clears its live session.
const retainedIdentities = new Map();
const identityCacheKey = player => hasPuuid(player) ? `puuid:${player.puuid}` : hasPlayerId(player?.summonerId) ? `id:${player.summonerId}` : null;
export function readRetainedIdentity(player) {
  return retainedIdentities.get(identityCacheKey(player));
}
export function retainIdentity(player, identity) {
  const key = identityCacheKey(player);
  if (!key || !identity.name) return;
  retainedIdentities.delete(key);
  retainedIdentities.set(key, identity);
  if (retainedIdentities.size > 200) retainedIdentities.delete(retainedIdentities.keys().next().value);
}
