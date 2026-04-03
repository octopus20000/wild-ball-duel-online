# Arcane Duel Online（回合制多人線上對戰）

這是一個更適合線上遊玩的**回合制雙人對戰**專案。  
不需要即時同步移動與碰撞，因此比即時球類對戰更穩、更容易異地連線。

## 玩法
- 左側為房主，右側為挑戰者
- 雙方每回合同步選招
- 動作：
  - 普通攻擊：3 傷害
  - 防禦：減少 2 傷害
  - 蓄力：+1 能量
  - 強襲：耗 2 能量，造成 6 傷害
  - 治療：耗 1 能量，恢復 3 HP

## 本機啟動
```bash
npm install
npm start
```

打開：
```text
http://localhost:3000
```

## Railway 部署
1. 把專案推到 GitHub
2. 在 Railway 建立專案
3. 選擇 **Deploy from GitHub repo**
4. 部署完成後，到：
   - Settings
   - Networking
   - Public Networking
   - Generate Domain
5. 取得公開網址，例如：
```text
https://your-game.up.railway.app
```

## 打包成 EXE
先設定你要連線的伺服器網址：

### PowerShell
```powershell
$env:APP_SERVER_URL="https://你的遊戲網址"
npm.cmd install
npm.cmd run desktop:pack
```

打包後輸出會在：
```text
dist/
```

## 注意
- 如果你是本機測試桌面版，`electron/runtime-config.json` 內建是 `http://localhost:3000`
- 若要給朋友使用，請先部署到 Railway / Render，再用公開網址重新打包 EXE
