# Monitor-Simple

简洁的 monitor 探针主题：总览条 + 状态筛选 + 亮暗切换。

[![ci](https://github.com/ipevel/monitor-theme-monitor-simple/actions/workflows/ci.yml/badge.svg)](https://github.com/ipevel/monitor-theme-monitor-simple/actions/workflows/ci.yml)

## 功能

**总览页**

- 总览条一格一个数：节点数 / 最忙节点 / 本月流量 / 7 天内到期（到期那格可点，直接筛出这些节点）
- 地区筛选（下拉）—— 直接读 API 的 `country` 字段，与卡片徽章同源
- 状态筛选：离线 / 即将到期 / 未接入
- 排序：默认 / CPU 占用 / 内存占用 / 本月流量 / 到期时间
- 搜索名称或地区
- 网格 / 列表视图
- 筛选条件写进 URL（`?country=日本&status=离线&sort=cpu&q=…`），可以直接分享，刷新也不丢
- 节点卡：名称 + 地区徽章 + 状态，三个大数字（CPU / 内存 / 硬盘），一行脚注（本月流量 / 到期 / 流量重置）
  - 80% 转琥珀、92% 转红，低于阈值一律不着色
  - 过期、即将到期、超流量、流量即将重置同样只在需要时着色
  - 离线或指标读不到的节点读数自动转为灰色，不冒充实时值

**详情页**

- 事实网格：系统 / CPU / 内存硬盘 / 架构 / 今日流量 / 续费
- 资源图表：CPU、内存、网络速率（带图例）、硬盘；尾部跟随实时推送
- 网络延迟：多探测线（逐条开关 + 削峰 + 丢包率）+ Brush 缩放

**实时性与状态**

- 页头指示数据来源：实时 / 轮询中 / 已断开
- WebSocket 6 秒没有消息即判定连接半开并主动重连；连线期间回落到 5 秒轮询
- 重连走指数退避（1 秒起，最长 30 秒）；标签页回到前台立刻拉取一次
- 指标逐字段降级：缺一个字段只影响那一格，并且区分「刚连上还没上报」与「数据不可用」
- 分块加载失败会重载一次（主题就地更新后，旧页面手里的 chunk 已经不存在了），仍失败则给出可操作的错误界面，而不是白屏

**主题**

- 亮/暗切换，跟随系统，localStorage 记忆
- 首屏不闪：`.dark` 在 `<head>` 的内联脚本里挂上，不用等 React
- 配色只有一层含义：灰阶做骨架，饱和度留给「需要处理」的两档告警（`--warn` 80%、`--destructive` 92%）；选中态用中性填充，不用彩色 pill
- 所有小字对所在底色至少 4.5:1，页底与卡片之间有明确明度差，四列卡片不会被看成一片

## 安装

把 `theme.tar.gz` 拖进面板「主题」页，或解压到 hub 的 `--themes` 位置：

```bash
mkdir -p /opt/monitor/data/themes/monitor-simple
tar xzf theme.tar.gz -C /opt/monitor/data/themes/monitor-simple
```

在后台「主题」页切换到 Monitor-Simple。

## 开发

```bash
npm ci
npm run dev        # 开发服务器，/api 代理到 127.0.0.1:9911
npm run lint
npm test
npm run build      # 构建到 dist/
```

`npm test` 钉住三处「改坏了界面不会报错、只会画错」的地方：`src/lib/format.ts` 的刻度阶梯、`src/lib/series.ts` 的削峰，以及 `src/lib/severity.ts` 的告警阈值。

## 分类说明

分类取 API 的 `country` 字段，匿名即可读到，因此筛选和卡片徽章永远一致。

若想按「建站 / 入口集群 / ix 互联 / 落地服务器」这类**角色**分类，需要先有一个可解析的命名约定并写进这里 —— `remark` 匿名读不到，只凭节点名去猜，猜出来的分类和徽章会分叉。

## 主题包

`theme.tar.gz` 包含 `dist/`、`theme.json`（以及存在时的 `preview.png`），即 hub 可安装的主题目录格式。

发布时打一个 `v*` tag，CI 会跑 lint / test / build、校验 `theme.json` 的 version 与 tag 一致，再把包和 sha256 挂到 Release 上。

## 许可

MIT，见 [LICENSE](LICENSE)。
