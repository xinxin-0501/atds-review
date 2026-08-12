# ATDS PRO · A股每日自动复盘工作台

电脑关机也能自动复盘。数据源：腾讯行情 + 东方财富公开接口（无需本机、无需任何付费服务）。

## 目录结构

| 路径 | 说明 |
|------|------|
| `scripts/cloud_fetch.mjs` | 云端采集脚本：腾讯行情（指数/自选池）+ 东财涨停/炸板池 + 涨跌家数 → 生成 `data/reviews/{日期}_{时间}.json` |
| `scripts/build_report.js` | 渲染脚本：JSON → 移动端复盘 HTML + 历史索引 `site/index.html` |
| `config.json` | 自选池与指数配置（修改自选池改这里） |
| `data/reviews/` | 每日复盘原始数据（D盘本地留存） |
| `site/` | 生成的静态站点（部署用） |
| `.github/workflows/daily-review.yml` | 定时工作流：工作日 08:30（盘前）+ 11:35（午盘）+ 15:20（收盘）自动运行 |

## 使用方式

### 本机手动生成（任何电脑，无需授权）

```bash
node --dns-result-order=ipv4first scripts/cloud_fetch.mjs close    # 收盘复盘
node --dns-result-order=ipv4first scripts/cloud_fetch.mjs midday   # 午盘快照
node scripts/build_report.js                                        # 渲染全部 HTML
```

### GitHub Actions 云端自动（关机也能跑）

1. 注册 GitHub 账号（免费）：https://github.com/signup
2. 在 WorkBuddy「连接器设置」中授权连接 GitHub
3. 在 GitHub 创建一个**私有仓库**，把本项目所有文件推送上去
4. 仓库 Settings → Pages → Source 选择 **GitHub Actions**
5. 推送后 Actions 会自动按计划运行（工作日 08:30 盘前 / 11:35 午盘 / 15:20 收盘 北京时间）
6. 线上地址：`https://{用户名}.github.io/{仓库名}/`

> 节假日由脚本自动判断：东财返回的最新行情日期不是当天则跳过，不生成重复报告。

## 修改自选池

编辑 `config.json` 的 `watchlist` 数组，添加/删除股票（code + setcode，6 开头沪市=1，00/30 开头深市=0），推送后下次自动生效。

## 合规声明

本系统仅做行情数据展示与信息聚合，不提供任何投资建议、不荐股、不预测涨跌。
