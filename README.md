# Monitor-Simple

简洁的 monitor 探针主题：统计卡 + 筛选标签 + 亮暗切换。

## 功能

- 总览页：节点数 / 最忙节点 / 累计流量 / 实时网速 4 个统计卡
- 场景分类筛选（建站 / 入口集群 / ix互联 / 落地服务器）
- 状态筛选（离线 / 即将到期 / 未接入）
- 搜索 + 网格/列表视图切换
- 节点卡片：CPU / 内存 / 硬盘 / 流量进度条，实时速率 + 累计流量
- 详情页：资源图表（CPU / 内存 / 网络 / 硬盘）+ 网络延迟（多探测线 + 削峰 + 丢包率 + 缩放）
- 亮/暗主题切换（跟随系统，localStorage 记忆）

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
npm run dev        # 开发服务器, /api 代理到 127.0.0.1:9911
npm run build      # 构建到 dist/
```

## 主题包

`theme.tar.gz` 包含 `dist/` 和 `theme.json`，是 hub 可安装的主题目录格式。

## 许可

MIT
