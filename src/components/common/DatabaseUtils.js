import {desktop} from '../../desktop/tauri';
export default class DatabaseUtils {
  static async saveGames(games) {
    const owners = [...new Set(games.map(game => game.ownerPuuid))];
    const result = [];
    for (const ownerPuuid of owners) result.push(await desktop.invoke('history_save_games', {ownerPuuid, games: games.filter(game=>game.ownerPuuid===ownerPuuid)}));
    return result;
  }
  static getExistingGameIds(ownerPuuid,gameIds) {return desktop.invoke('history_existing_game_ids',{ownerPuuid,gameIds});}
  static getAllGamesByOwnerPuuid(ownerPuuid,limit=1000) {return desktop.invoke('history_list_games',{ownerPuuid,limit});}
  static trimGamesByOwnerPuuid(ownerPuuid,retainCount) {return desktop.invoke('history_trim',{ownerPuuid,retainCount});}
}
