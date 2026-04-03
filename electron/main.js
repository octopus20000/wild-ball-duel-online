const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

function resolveServerUrl() {
  const envUrl = process.env.APP_SERVER_URL;
  if (envUrl) return envUrl;
  try {
    const cfgPath = path.join(__dirname, "runtime-config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      if (cfg.serverUrl) return cfg.serverUrl;
    }
  } catch {}
  return "http://localhost:3000";
}

function createWindow() {
  const targetUrl = resolveServerUrl();
  const win = new BrowserWindow({
    width: 1420,
    height: 940,
    minWidth: 1160,
    minHeight: 760,
    show: false,
    backgroundColor: "#08101d",
    title: "Wild Ball Tactics Online",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    dialog.showErrorBox(
      "載入失敗",
      `無法開啟遊戲頁面。\n\n網址：${validatedURL || targetUrl}\n錯誤：${errorDescription} (${errorCode})`
    );
  });

  win.webContents.on("did-finish-load", () => {
    win.show();
  });

  win.loadURL(targetUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
