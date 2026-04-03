# Wild Ball Duel Online 專案

這是一個 **權威伺服器(authoritative server)** 的 2 人即時連線對戰專案。  
房主固定在左側，挑戰者固定在右側；雙方都用同一套本機按鍵邏輯，但可以各自在自己的電腦上改鍵。

## 這版新增
- 雙方都準備後，自動切換成 **聚焦遊戲畫面**
- ESC 暫停選單
- 更乾淨的大廳 / 遊戲排版
- Electron 桌面包裝骨架，可打成 Windows 可攜式 EXE

## 建議 Node.js 版本
- **Node.js 24 LTS**
- 也可用 **Node.js 22 LTS**

## 本機啟動
```bash
npm install
npm run server
```

瀏覽器開：
```text
http://localhost:3000
```

## 同機雙分頁測試
1. 開兩個瀏覽器分頁
2. 一邊建立房間
3. 另一邊輸入房號加入
4. 雙方都按「準備」
5. 介面會自動切成聚焦遊戲畫面

## 區網讓另一台電腦進來
假設主機區網 IP 是 `192.168.1.23`

另一台電腦開：
```text
http://192.168.1.23:3000
```

## 異地連線
把伺服器部署到雲端，例如：
- Railway
- Render
- VPS + PM2 + Nginx

部署後雙方都打開：
```text
https://your-game.example.com
```

## Electron 桌面版

### 本機測試
先開伺服器：
```bash
npm run server
```

再開桌面版：
```bash
npm run desktop:dev
```

### 指向遠端伺服器
Windows PowerShell：
```powershell
$env:APP_SERVER_URL="https://your-game.example.com"
npm run desktop:dev
```

### 打包 EXE
```bash
npm run desktop:pack
```

完成後會在：
```text
dist/
```
看到可攜式 EXE。

## 給另一台電腦用 EXE 是否可行？
可以，但 EXE 只是「桌面前端」。  
真正連線還是要連到你的伺服器網址。

所以最佳做法是：
1. 先把伺服器部署到雲端
2. 再用 `APP_SERVER_URL` 指到雲端網址打包 EXE
3. 另一台電腦直接開 EXE，就能進建立 / 加入房間畫面

## 專案結構
```text
netduel_project/
  public/
    index.html
    style.css
    client.js
  src/
    constants.js
    gameRoom.js
    roomManager.js
  electron/
    main.js
    preload.js
  server.js
  package.json
```


## Electron 黑畫面排查

如果打開 EXE 一片黑，最常見原因是桌面版沒有拿到正確的伺服器網址。
這個專案已改成在 **打包時** 讀取 `APP_SERVER_URL` 並寫入 `electron/runtime-config.json`。

打包前請先在 PowerShell 設定：

```powershell
$env:APP_SERVER_URL="https://你的Railway網址"
npm.cmd install
npm.cmd run desktop:pack
```

打包出的 EXE 會把這個網址內建進去。
如果載入失敗，Electron 也會跳出錯誤視窗顯示目前嘗試連線的 URL。


## 本次低回朔修正
- 本地角色以弱校正為主，不再頻繁硬貼伺服器座標。
- 球維持伺服器權威，只做視覺插值。
- 本機雙瀏覽器測試將插值延遲降到 25ms，以減少體感延遲。


## v6 體感優化
- 本地玩家改成更弱的伺服器校正，優先降低回朔感。
- 球加入獨立 visualBall 平滑層，畫面更順。
- renderDelayMs 調低到 18，較適合同機雙瀏覽器測試。
