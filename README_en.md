<div align=center>
<h1>LOL Auto-Accept Assistant Tool</h1>
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
  This application automatically accepts League of Legends matches for you and provides several additional handy features.
</div>

English | [中文](./README.md)

## ✨ Features
1. **🚀 Auto-Accept Matches**: Automatically accepts a valid ready check when enabled.
   If a match is accepted and you change your mind, you can reject it from the application interface by clicking "Decline Match".
2. **🏆 Display Teammate Scores During Champion Selection**: This feature is inactive if the server no longer displays player names.
3. **👥 Display Duo Players**: In-game, shows duo (or multi) players on both sides, sorted by the number of players.
4. **📖 Display Selected Role**: In-game, shows the Selected Role for players on both sides.
5. **🎲 ARAM**: During ARAM champion selection, you can pre-select your teammates' champions. If one of these champions is rolled, the program will automatically select it for you.
6. **🪪 Modify Hovercard**: Hover over your avatar to see the effect.

## 🌟 Description
- **Background Operation**: Closing the window keeps the application running in the system tray. Choose Exit to quit.
- **Non-Intrusive to Game Files**: Does not inject or alter game files, maintaining the game's integrity.
- **Local Client Integration**: Uses the LeagueClient API. Client updates or unavailable data can affect individual features.

## 🖥 Screenshots
<p align="center">
  <img src="resources/github/screenshot/en/screenshot.png" width="80%" />
</p>

## 🔍 FAQ
### 1. Will using this result in a banned account?
- Numerous users have employed this tool for over three years without any account bans.  
  I assume no responsibility; please assess the risks yourself.  
  If in doubt, refrain from using it.

### 2. Why did a feature stop working?
- All functionalities are entirely dependent on the LeagueClient API. If the official API is updated, some features may become inactive.

### 3. How do I remove the program?
- Choose Exit in the system tray, then delete the EXE. Configuration and history are preserved.

### 4. Where is the configuration file?
- Under normal circumstances, there is no need to access the configuration file.
- Configuration: `%APPDATA%\io.github.jasonwu1994.lolautoaccept\config.json`
- History: `%APPDATA%\io.github.jasonwu1994.lolautoaccept\history\history.sqlite3`
- On first launch, history from the previous location is automatically copied to the new location. The original file is preserved as a backup.
- Close the old application first. On first launch, settings are read from `app-config.json` in the configuration or executable directory, including the old `resources/app/app-config.json` location. Missing values use defaults and the old file is left unchanged. Match history is fetched from the game client on demand; no import is required.

## 🎉 Conclusion
**If you find this program helpful, please give it a ⭐️！**  
**Your support is the greatest encouragement for me！**