// main.js

const { app, BrowserWindow, ipcMain } = require('electron');

// 记录主窗口的引用
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    frame: false,               // 无边框窗口
    titleBarStyle: 'hiddenInset', // 也可设置 'hidden' 或其他
    webPreferences: {
      // 关键：允许在 renderer.js 里使用 require('electron')
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 载入页面
  mainWindow.loadURL(`file://${__dirname}/src/index.html`);

  // 如果需要调试，可打开开发者工具
  // mainWindow.webContents.openDevTools();
}

// 等待 Electron 初始化完毕后再创建窗口
app.whenReady().then(() => {
  createWindow();

  // Mac 平台特有处理：当全部窗口都关闭时，单击 Dock 图标可重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 监听所有窗口关闭事件（针对非 macOS 平台，一般使用 quit()）
app.on('window-all-closed', () => {
  // 在 macOS 上，默认不会在关闭最后一个窗口后退出
  // 所以只有在非 macOS 时才执行 app.quit()
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/* 
 * ================
 *  IPC 处理部分
 * ================
*/
ipcMain.on('minimize-window', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.minimize(); // 最小化当前窗口
  }
});

ipcMain.on('close-window', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.close();    // 关闭当前窗口
  }
});

// 如果你需要更多操作，比如最大化/还原：
ipcMain.on('maximize-window', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    // 若已经最大化就还原，否则最大化
    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize();
    } else {
      senderWindow.maximize();
    }
  }
});
