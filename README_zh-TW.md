# Wild Ball Tactics Online

這是一個比純回合制數值對打更有趣的**回合制戰術球鬥**雙人線上遊戲。

## 核心玩法
- 左側為房主，右側為挑戰者
- 每回合同步選擇：
  - 站位：上 / 中 / 下
  - 球技：抽射 / 爆射 / 曲球 / 封堵 / 蓄力
  - 戰術卡（可不選）
- 球當前在哪一路、你選哪一路、對手選什麼，會一起影響結算
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
5. 取得公開網址，例如：
```text
https://your-game.up.railway.app
```

## 打包成 EXE
### 本機測試
```powershell
npm.cmd install
npm.cmd run desktop:pack
```

### 連遠端伺服器
```powershell
$env:APP_SERVER_URL="https://你的遊戲網址"
npm.cmd run desktop:pack
```

## 適合後續擴充的方向
- 更多戰術卡
- 不同角色被動
- 排行榜
- 觀戰模式
- 房間觀眾席
