const {app, BrowserWindow, ipcMain, Menu, Tray, shell, nativeTheme} = require('electron')
const path = require('path');
const LCUConnector = require('lcu-connector');
const RiotWSProtocol = require('./lcu-ws.js');
const isDev = require('electron-is-dev');
const Store = require('electron-store');
const config = {name: 'app-config', fileExtension: 'json', cwd: path.dirname(__dirname)}
const store = new Store(config);
const express = require('express');
const proxy = require('express-http-proxy');
const net = require('net');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
global.auth = {};
let mainWinId = null
let win = undefined
let tray = undefined
global.timers = {
  authInterval: [],
  cancelInterval: []
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
console.log("version:", app.getVersion())
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  });
  const server = express();
  // proxy
  server.use('/lol', (req, res, next) => {
    const targetPort = req.headers['x-target-port'] || '0';
    const proxyUrl = `https://127.0.0.1:${targetPort}`;

    return proxy(proxyUrl, {
      proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
        proxyReqOpts.headers['Host'] = `127.0.0.1:${targetPort}`;
        return proxyReqOpts;
      },
      userResDecorator: function (proxyRes, proxyResData, userReq, userRes) {
        const exchange = `[${userReq.method}] [${proxyRes.statusCode}] ${userReq.path} -> ${proxyRes.connection.remoteAddress}`;
        console.log(exchange);
        return proxyResData;
      },
      proxyReqPathResolver: function (req) {
        // 路徑重寫
        const resolvedPath = req.originalUrl.replace('/lol/', '/');
        console.log(`解析後的路徑: ${resolvedPath}`);
        return resolvedPath;
      }
    })(req, res, next);
  });

  function findFreePort(start, range, maxAttempts, attemptLogs = []) {
    return new Promise((resolve, reject) => {
      if (attemptLogs.length >= maxAttempts) {
        console.log(`嘗試以下端口均失敗: ${attemptLogs.join(', ')}`);
        reject(new Error('找不到可用的端口'));
        return;
      }

      let currentPort = start + Math.floor(Math.random() * range);
      const server = net.createServer();

      server.listen(currentPort, () => {
        server.once('close', () => {
          resolve(currentPort);
        });
        server.close();
      });

      server.on('error', () => {
        attemptLogs.push(currentPort);
        resolve(findFreePort(start, range, maxAttempts, attemptLogs));
      });
    });
  }

  app.whenReady().then(() => {
    findFreePort(10000, 5000, 10).then((freePort) => {
      server.use(express.static(path.join(__dirname, '../build')));
      server.listen(freePort, () => {
        console.log(`Server running on http://localhost:${freePort}`);
      });

      initTray();
      initTheme()
      createWindow(freePort);
      lolListener();

    }).catch((error) => {
      console.error(error.message);
      app.quit(); // 找不到可用端口，關閉程式
    });
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

function initTheme() {
  const config = store.get('config');
  if (config && typeof config.isDarkMode !== 'undefined') {
    nativeTheme.themeSource = config.isDarkMode ? 'dark' : 'light';
    return;
  }
  if (nativeTheme.shouldUseDarkColors) {
    nativeTheme.themeSource = 'dark'
  } else {
    nativeTheme.themeSource = 'light'
  }
}

//創建主視窗
function createWindow(freePort) {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
  })
  win.setIcon(path.join(__dirname, '../resources/icon.ico'))
  win.on('close', (event) => {
    event.preventDefault()
    win.hide();
  });
  const url = isDev
    ? 'http://localhost:8080'
    : `http://127.0.0.1:${freePort}`;

  win.loadURL(url)
  mainWinId = win.id
  if (!isDev) Menu.setApplicationMenu(null)
  win.webContents.once('dom-ready', () => {
    console.log('mainWindow finished loading', global.auth, Object.keys(global.auth).length > 0);
    if (Object.keys(global.auth).length > 0) {
      // 每一秒發一送auth訊息
      let authInterval = setInterval(() => {
        console.log('Resending auth message');
        win.webContents.send('auth', global.auth);
      }, 1000);

      // 1分鐘後自動取消auth定時器
      let cancelInterval = setTimeout(() => {
        console.log('Automatically canceling auth message resend after 1 minute');
        global.timers.authInterval.forEach(s => clearInterval(s))
      }, 60 * 1000);
      global.timers.authInterval.push(authInterval)
      global.timers.cancelInterval.push(cancelInterval)
    }
    //send config
    win.webContents.send('set-config', store.get('config'));
  });
}


function lolListener() {
  const connector = new LCUConnector();
  connector.on('connect', data => {
    console.log('League Client has started', data);
    BrowserWindow.fromId(mainWinId).webContents.send('lol-connect', '');
    global.auth = data
    BrowserWindow.fromId(mainWinId).webContents.send('auth', data);
    try {
      connectWithRetry(`wss://${data.username}:${data.password}@${data.address}:${data.port}/`, 10);
    } catch (error) {
      console.error(`Caught error: ${error}`);
    }
  });
  connector.on('disconnect', () => {
    console.log('League Client has been closed');
    BrowserWindow.fromId(mainWinId).webContents.send('lol-disconnect', '');
  });
  connector.start();
}

const connectWithRetry = (url, retriesLeft) => {
  console.log(`Attempting to connect to ${url}. Retries left: ${retriesLeft}`);
  const ws = new RiotWSProtocol(url);
  ws.on('error', error => {
    console.error(`Error: ${error}`);
    if (retriesLeft === 0) {
      console.error('No more retries left. Exiting...');
      return;
    }
    setTimeout(() => {
      console.error('Retrying: ', retriesLeft);
      connectWithRetry(url, retriesLeft - 1);
    }, 2000);
  });
  ws.on('open', () => {
    console.log(`Connected to ${url}`);
    retriesLeft = 0;
    ws.subscribe('OnJsonApiEvent', handleOnLoginSession);
    ws.subscribe('OnJsonApiEvent_lol-gameflow_v1_gameflow-phase', handleOnGameflowPhase);
  });
  ws.on('close', () => {
    console.log(`Connection to ${url} closed`);
    if (retriesLeft === 0) {
      BrowserWindow.fromId(mainWinId).webContents.send('lol-disconnect', '');
    }
  })
};

function handleOnLoginSession(payload) {
  // console.log(payload);
  if (payload.eventType === 'Create' && payload.uri === '/lol-champ-select/v1/all-grid-champions') {
    BrowserWindow.fromId(mainWinId).webContents.send('auth', global.auth);
  }

  if (payload.uri.includes('/lol-champ-select/v1/summoners/') && payload.data.championId !== 0) {
    console.log("champ-select/summoners", JSON.stringify(payload, null, 2));
    BrowserWindow.fromId(mainWinId).webContents.send('champ-select-summoners', payload.data);
  }

  if (payload.uri === '/lol-champ-select/v1/session' && payload.eventType !== 'Delete') {
    console.log("champ-select/session ", JSON.stringify(payload, null, 2));
    BrowserWindow.fromId(mainWinId).webContents.send('champ-select-session', payload.data);
  }

}

function handleOnGameflowPhase(payload) {
  console.log(payload);
  const phase = payload.data;
  handleGamePhase(phase)
}

ipcMain.on('switch-native-theme', (_, message) => {
  if (['dark', 'light'].includes(message)) {
    nativeTheme.themeSource = message
  }
})

ipcMain.on('get-auth', (ev, data) => {
  ev.reply('auth', global.auth)
  console.log("get-auth and reply ", global.auth)
})

ipcMain.on('kill-lol', async (ev, data) => {
  try {
    const tasklist = await import('tasklist');
    const taskkill = await import('taskkill');
    let process = await tasklist.tasklist()
    let lolprocess = process
      .filter(p => p.imageName.includes("League") || p.imageName.includes("RiotClient"))
      .map(p => ({pid: p.pid, imageName: p.imageName}));
    console.log(lolprocess, lolprocess.length);
    if (lolprocess.length === 0) {
      ev.reply('kill-lol-ack', lolprocess)
      return
    }
    await taskkill.taskkill(lolprocess.map(p => p.pid), {force: true});
    ev.reply('kill-lol-ack', lolprocess)
  } catch (error) {
    ev.reply('kill-lol-ack', [])
    console.error('Error importing tasklist:', error);
  }
})

ipcMain.handle('get-config', () => {
  return store.get('config');
});

ipcMain.on('set-config', (event, config) => {
  console.log('Received [set-config] from react', config);
  store.set('config', config);
});

ipcMain.on('auth-ack', (event, arg) => {
  console.log('Received [auth-ack] from react', arg);
  handleGamePhase(arg)
  global.timers.authInterval.forEach(s => clearInterval(s))
  global.timers.cancelInterval.forEach(s => clearTimeout(s))
});

ipcMain.on('open-link', (event, url) => {
  console.log('Received [open-link] from react', url);
  shell.openExternal(url);
});

ipcMain.on('always-on-top', (event, url) => {
  console.log('Received [always-on-to] from react', url);
  if (win.isAlwaysOnTop()) {
    win.setAlwaysOnTop(false)
  } else {
    win.setAlwaysOnTop(true)
  }
});

function handleGamePhase(phase) {
  const mainWindow = BrowserWindow.fromId(mainWinId).webContents;
  switch (phase) {
    case "None":
      console.log("遊戲大廳");
      mainWindow.send("None", phase);
      break;
    case "Lobby":
      console.log("已開房組隊");
      mainWindow.send("Lobby", phase);
      break;
    case "Matchmaking":
      console.log("正在列隊中");
      mainWindow.send("Matchmaking", phase);
      break;
    case "ReadyCheck":
      console.log("已排到對戰，等待接受");
      mainWindow.send("ReadyCheck", phase);
      break;
    case "ChampSelect":
      console.log("選擇英雄中");
      mainWindow.send("ChampSelect", phase);
      break;
    case "GameStart":
      console.log("遊戲開始");
      mainWindow.send("GameStart", phase);
      break;
    case "InProgress":
      console.log("遊戲中");
      mainWindow.send("InProgress", phase);
      break;
    case "PreEndOfGame":
      console.log("遊戲即將結束");
      mainWindow.send("PreEndOfGame", phase);
      break;
    case "EndOfGame":
      console.log("遊戲結束");
      mainWindow.send("EndOfGame", phase);
      break;
    default:
      console.log("未知遊戲階段", phase);
  }
}


function initTray() {
  tray = new Tray(path.join(__dirname, '../resources/icon.ico'))
  tray.on('click', function (event) {
    win.show()
    win.focus()

    // Show devtools when command clicked
    if (win.isVisible() && process.defaultApp && event.metaKey) {
      win.openDevTools({mode: 'detach'})
    }
  })
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open', type: 'normal', click: async () => {
        win.show()
        win.focus()
      }
    },
    {
      label: 'Exit', type: 'normal', click: async () => {
        win.webContents.send('get-config');
        app.exit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
}