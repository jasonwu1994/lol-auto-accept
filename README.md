<div align=center>
<h1>LOL自動接受輔助工具</h1>
  <img width="350" height="350" src="./resources/logo.png?raw=true"/>
</div>

<div align="center">

![Static Badge](https://img.shields.io/badge/react-19-blue)
![Static Badge](https://img.shields.io/badge/Tauri-2.12.5-blue)

[![GitHub release](https://img.shields.io/github/v/release/jasonwu1994/lol-auto-accept)](https://github.com/jasonwu1994/lol-auto-accept/releases)
![downloads](https://img.shields.io/github/downloads/jasonwu1994/lol-auto-accept/total)
![stars](https://img.shields.io/github/stars/jasonwu1994/lol-auto-accept)

</div>

<div align=center>
  本程式可幫你自動接受英雄聯盟的對戰，還提供一些額外實用的功能
</div>

[English](./README_en.md) | 中文

## ✨ 功能
1. **🚀自動接受對戰**：啟用後，在收到有效的對戰確認時自動接受
   如果排到對戰且已經自動接受，可以反悔，只需要在程式介面中按下"拒絕對戰"
2. **🏆選角時顯示隊友積分**：如果所在伺服器已不顯示玩家名稱，功能失效
3. **👥顯示雙排玩家**：遊戲中，顯示雙方雙排(多排)玩家，會按照人數排序
4. **📖顯示列隊規則**：遊戲中，顯示雙方玩家列隊規則
5. **🎲隨機單中(ARAM)**：ARAM選角時，可先勾選隊友的英雄，如果英雄被骰出來，幫你自動選取
6. **🪪修改名片**：滑鼠放到自己的頭像上可看到效果

## 🌟 說明
- **背景運作**：關閉視窗後仍在系統匣執行；可在系統匣選擇 Exit 完全退出
- **不干預遊戲內檔案**：不會對遊戲檔案進行注入或修改，保持遊戲純淨
- **本機用戶端整合**：透過 LeagueClient API 運作；官方用戶端更新或缺少資料時，部分功能可能無法使用

## 🖥 截圖
<p align="center">
  <img src="resources/github/screenshot/zh/screenshot.png" width="80%" />
</p>

## 🔍 FAQ
### 1. 使用後會不會被封鎖帳號？
- 多位用戶使用超過三年，無任何帳號被鎖   
  本人不負任何責任，請自行評估使用風險  
  如有疑慮，請勿使用

### 2. 為什麼功能失效了？
- 功能完全依賴LeagueClient API，如果官方API更新，可能導致部分功能失效

### 3. 如何刪除程式？
- 在系統匣選擇 Exit 後，刪除 EXE 即可。設定與歷史資料保留。

### 4. 設定檔在哪裡？
- 一般情況不需要動到設定檔
- 設定：`%APPDATA%\io.github.jasonwu1994.lolautoaccept\config.json`
- 歷史：`%APPDATA%\io.github.jasonwu1994.lolautoaccept\history\history.sqlite3`
- 舊版歷史資料會在首次啟動時自動複製到新位置，舊檔保留作為備份。
- 請先正常關閉舊版。首次啟動會讀取設定目錄或程式旁的 `app-config.json`（也支援舊版 `resources/app/app-config.json`）；缺值使用預設設定，舊檔不改寫。戰績由遊戲客戶端按需讀取，無需匯入。

## 🎉 結尾
  **如果這個程式對您有幫助，請給個⭐️！**  
  **這是對我最大的鼓勵！**