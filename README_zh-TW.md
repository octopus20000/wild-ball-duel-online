# Wild Ball Tactics Online（圖像化版）

這是一個更遊戲化的**回合制戰術球鬥**多人線上專案。  
保留你喜歡的動物與球場感，但改成適合異地連線的同步揭曉玩法。

## 核心特色
- 房主左側、挑戰者右側
- 每回合同步選：
  - 站位（上 / 中 / 下）
  - 球技（抽射 / 爆射 / 曲球 / 封堵 / 蓄力）
  - 戰術卡（可不選）
- 球目前在哪一路非常重要
- 先拿 5 分，或把對手生命打到 0，就獲勝

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
1. 專案推到 GitHub
2. Railway -> New Project
3. Deploy from GitHub repo
4. 部署完成後：
   - Settings
   - Networking
   - Public Networking
   - Generate Domain
5. 取得公開網址

## 打包 EXE
本機測試：
```powershell
npm.cmd install
npm.cmd run desktop:pack
```

遠端連線：
```powershell
$env:APP_SERVER_URL="https://你的遊戲網址"
npm.cmd run desktop:pack
```
