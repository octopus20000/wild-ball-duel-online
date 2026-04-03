const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveStartUrl() {
  const envUrl = process.env.APP_SERVER_URL;
  if (envUrl) return envUrl;

  const runtimeConfigPath = path.join(__dirname, 'runtime-config.json');
  try {
    if (fs.existsSync(runtimeConfigPath)) {
      const raw = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
      if (raw && typeof raw.serverUrl === 'string' && raw.serverUrl) {
        return raw.serverUrl;
      }
    }
  } catch (err) {
    console.error('Failed reading runtime config:', err);
  }

  return 'http://localhost:3000';
}

const startUrl = resolveStartUrl();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#0b1324',
    autoHideMenuBar: true,
    title: 'Wild Ball Duel Online',
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    const msg = `載入失敗

URL: ${validatedURL}
錯誤代碼: ${errorCode}
錯誤訊息: ${errorDescription}

目前設定的伺服器網址:
${startUrl}

如果你是打包 EXE，請確認打包時有設定 APP_SERVER_URL。`;
    dialog.showErrorBox('Wild Ball Duel Online 載入失敗', msg);
  });

  win.webContents.on('did-finish-load', () => {
    win.show();
  });

  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
