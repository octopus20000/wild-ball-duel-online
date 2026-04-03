const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("wildBallTacticsShell", {
  platform: "desktop"
});
