import PouchDB from 'pouchdb';

class DatabaseUtils {

  static dbInstance = null;

  static initializeDB(dbName = "games") {
    if (!this.dbInstance) {
      this.dbInstance = new PouchDB(dbName);
      console.log(`資料庫 ${dbName} 已初始化`);
    }
    return this.dbInstance;
  }

  static async saveGame(game) {
    try {
      // 檢查是否已存在該遊戲
      const existingDoc = await this.dbInstance.get(game._id).catch(err => {
        if (err.status === 404) return null; // 遊戲不存在
        throw err;
      });
      let action = "新增"; // 預設為新增
      // 如果遊戲已存在，更新 _rev 以進行更新操作
      if (existingDoc) {
        game._rev = existingDoc._rev;
        action = "更新"; // 將操作改為更新
      }
      // 儲存或更新遊戲
      const result = await this.dbInstance.put(game);
      console.log(`遊戲已${action}: ${game._id}`);
      return result;
    } catch (err) {
      console.error(`儲存或更新遊戲時發生錯誤 (gameId: ${game._id}): ${err.message}`);
      return null;
    }
  }

  static async saveGames(games) {
    const results = [];

    for (const game of games) {
      try {
        const result = await this.saveGame(game);
        results.push(result);
      } catch (err) {
        console.error(`批量儲存遊戲時發生錯誤 (gameId: ${game._id}): ${err.message}`);
      }
    }

    console.log(`批量儲存完成，共處理 ${games.length} 筆遊戲資料`);
    return results; // 返回所有的結果（成功或失敗的紀錄）
  }

  static async getGame(id) {
    try {
      const doc = await this.dbInstance.get(id);
      console.log(`讀取文檔成功: ${id}`);
      return doc;
    } catch (err) {
      if (err.status === 404) {
        console.warn(`文檔不存在: ${id}`);
        return null;
      }
      console.error(`讀取文檔時發生錯誤: ${err.message}`);
      throw err;
    }
  }

  static async getAllGames(options = {include_docs: true, descending: true,}) {
    try {
      const allDocs = await this.dbInstance.allDocs(options);
      return allDocs;
    } catch (err) {
      console.error(`讀取所有文檔時發生錯誤: ${err.message}`);
      throw err;
    }
  }

  // 返回array
  static async getAllGamesByOwnerPuuid(ownerPuuid, options = {include_docs: true, descending: true,}) {
    try {
      const allDocs = await this.dbInstance.allDocs(options);
      const filteredDocs = allDocs.rows
        .filter(row => row.doc && row.doc.ownerPuuid === ownerPuuid) // 篩選條件
        .map(row => row.doc); // 提取文檔內容
      return filteredDocs;
    } catch (err) {
      console.error(`讀取指定 ownerPuuid 的文檔時發生錯誤: ${err.message}`);
      throw err;
    }
  }

  static async trimGamesByOwnerPuuid(ownerPuuid, retainCount) {
    try {
      const allGames = await this.getAllGamesByOwnerPuuid(ownerPuuid, {
        include_docs: true,
        descending: false, // 按照 _id 遞增排序（最小的 _id 在前）
      });

      console.log(`Owner ${ownerPuuid} 總共有 ${allGames.length} 筆資料`);

      // 如果需要保留的場次大於等於現有的場次，則無需刪除
      if (allGames.length <= retainCount) {
        console.log(`保留場次(${retainCount})大於等於現有場次，無需刪除`);
        return [];
      }

      // 找出需要刪除的資料（超過 retainCount 的部分）
      const gamesToDelete = allGames.slice(0, allGames.length - retainCount); // 最小的 _id 在前
      console.log(`需要刪除的文檔數量: ${gamesToDelete.length}`);

      // 標記需要刪除的文檔，並批量刪除
      const docsToDelete = gamesToDelete.map(game => ({
        ...game,
        _deleted: true,
      }));

      const result = await this.dbInstance.bulkDocs(docsToDelete);
      console.log(`成功刪除 ${result.filter(res => res.ok).length} 筆文檔`);

      return result;
    } catch (err) {
      console.error(`刪除 ownerPuuid ${ownerPuuid} 的多餘場次時發生錯誤: ${err.message}`);
      throw err;
    }
  }

  static async deleteGame(id) {
    try {
      const doc = await this.dbInstance.get(id);
      const result = await this.dbInstance.remove(doc._id, doc._rev);
      console.log(`文檔已刪除: ${id}`);
      return result;
    } catch (err) {
      if (err.status === 404) {
        console.warn(`文檔不存在: ${id}`);
        return null;
      }
      console.error(`刪除文檔時發生錯誤: ${err.message}`);
      throw err;
    }
  }

  static async deleteGames(ids) {
    try {
      const docsToDelete = await Promise.all(
        ids.map(async id => {
          const doc = await this.dbInstance.get(id);
          return {...doc, _deleted: true};
        })
      );
      const result = await this.dbInstance.bulkDocs(docsToDelete);
      console.log(`批量刪除完成，已刪除 ${ids.length} 筆文檔`);
      return result;
    } catch (err) {
      console.error(`批量刪除文檔時發生錯誤: ${err.message}`);
      throw err;
    }
  }

  static async deleteAllData(dbName = "games") {
    try {
      await this.dbInstance.destroy();
      console.log(`資料庫 ${dbName} 的所有資料已刪除`);
      this.dbInstance = null;
    } catch (err) {
      console.error(`刪除資料庫 ${dbName} 的資料時發生錯誤: ${err.message}`);
      throw err;
    }
  }

}

// 使用 Proxy 代理 DatabaseUtils 本身
const handler = {
  get(target, property) {
    // 如果訪問的是方法，進行攔截
    if (typeof target[property] === "function") {
      return async function (...args) {
        // 確保資料庫已初始化
        if (!target.dbInstance) {
          console.warn("資料庫未初始化，正在自動初始化...");
          target.initializeDB();
        }
        // 調用原方法
        return await target[property](...args);
      };
    }

    // 非方法直接返回
    return target[property];
  }
};

// 代理整個 DatabaseUtils 類
const DatabaseProxy = new Proxy(DatabaseUtils, handler);

// 覆蓋 DatabaseUtils，外部仍使用 DatabaseUtils 調用
export default DatabaseProxy;