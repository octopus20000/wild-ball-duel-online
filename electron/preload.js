const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("arcaneShell", {
  platform: "desktop"
});
