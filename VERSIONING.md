# 版本策略

本仓库遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。本文说明「什么算破坏性变更」、
版本号与 tag 怎么写，以及 CI 门禁会拦什么。改版本号前请先读完前两节。

发布流程的完整步骤（本机注意事项、代理、发布后回归）记在 `.notes/发布与验证.md`，
该目录未纳入版本管理，是本机笔记。

## 1. 什么是本项目的公共 API

主题不是私有代码：它被面板加载、被用户的浏览器执行、通过 GitHub 被第三方安装。
以下内容构成**公共 API**，改动它们会影响使用方，必须计入版本号：

| 公共 API | 具体范围 | 谁在依赖 |
| --- | --- | --- |
| 主题包格式 | `theme.json` 的顶层字段（`name`/`short`/`description`/`version`/`author`/`url`）与 `config[]` 条目（`key`/`type`/`label`/`default`/`help`） | 面板的配置界面负责渲染表单；第三方主题也照此格式 |
| 配置键 | `config[].key` 的取值集合。**删除或改名一个 key = 破坏性变更**；新增 key = 向后兼容新增（`default` 必须让旧面板仍能显示合理默认值） | 用户已保存的设置按 key 回填 |
| 面板接口契约 | `GET /api/me`、`GET /api/nodes`、`GET /api/ws`（v1.4.0 起带 `?gzip` 收 gzip 二进制帧；旧 hub 与站长登录时仍推文本帧，两种都收）、`GET /api/nodes/{id}/metrics` 及其字段 | 主题直接消费这些响应 |
| 呈现契约 | 主题渲染出的 DOM 结构与 CSS 自定义属性（`--slte-*` 之类），面板用它们做布局与取色 | 面板的样式注入与无障碍逻辑 |

### 已知的不成文约定

- **目标适配下限是 hub v1.0.0**：本主题只用 hub v1.0.0 就有的接口，对后来新增的字段
  （`month_used`、地址取舍、`ipv4_pin`/`ipv6_pin`/`country` → hub v1.2.0；`expires_in` → hub v1.3.0；
  `last_seen_ago` → hub v1.4.0）一律带回退，字段缺失时不影响渲染。
- **只做向后兼容的加法**：任何一次版本递增都不应让「hub v1.0.0 + 任意版本主题」这个组合失效。
  新增可选字段并提供回退，是这套约定下唯一安全的扩展方式。

## 2. MAJOR / MINOR / PATCH 怎么定

| 递增位 | 何时递增 | 本项目典型例子 |
| --- | --- | --- |
| **MAJOR**（X） | 删掉或重命名 `config[].key`；改变面板读到的字段含义；`theme.json` 字段改名或移除；把适配下限抬到高于 hub v1.0.0 | 移除 `country` 配置项 |
| **MINOR**（Y） | 新增 `config[].key`（带 `default` 回退）；新增节点指标卡；消费新的 hub 字段并带回退；依赖的 hub 版本要求上调但仍向下兼容 | v1.9.0 视觉升级、v1.10.0 加 2×2 指标、v1.11.0 适配 hub v1.3.1、**v1.13.0 适配 hub v1.4.0**（`/api/ws?gzip` 二进制帧、`last_seen_ago` 离线时长、`apple-touch-icon`） |
| **PATCH**（Z） | 纯修复：数值算错、文案错、排序错、图标缺、动效抖动、CI 缺陷、许可证补齐、依赖安全修复 | v1.9.1 补齐国旗、v1.9.2 排序下拉修复、**v1.13.1 修 source-map-js 高危** |

判断口诀：**用户需不需要改设置**。要改 → MAJOR；白得一个新开关 → MINOR；
什么都不用改 → PATCH。定不下来时看第 1 节的表，只有一行能决定答案。

## 3. 版本号与 tag 的规则

- **版本号形态**：`X.Y.Z`，三段，非负整数且无前导零。`1.2` 和 `1.02.0` 都不是合法版本号。
- **两处声明必须相同**：`package.json` 的 `version` 与 `theme.json` 的 `version`。
  这不是「尽量保持一致」，是硬性要求——门禁会逐字比对。
- **tag 形态**：`v` + 版本号，例如 `v1.11.0`。tag 名必须与 `theme.json` 的值精确对应，
  `v1.11.0` 对 `1.11.1` 会被门禁拦下。
- **新 tag 一律用 annotated**：`git tag -a v1.11.0 -m "v1.11.0"`。轻量 tag 没有作者与时间，
  `git describe` 和 Release 页面都读不出来。
- **已发布的 tag 不动**：本仓库历史上有一部分轻量 tag，**不追溯改写**。重打 tag 会改变
  它的对象 ID，等同于篡改一个已经发布出去的版本——这正是本文件第 4 节禁止的事。
- **版本号不能被消耗**：一个版本号一旦写进 `theme.json` 并合入主干，就意味着它被消耗了，
  随后必须真的发布。历史审计会揪出「写进代码却从未打 tag」的版本号
  （本仓库已记两笔，既成欠账，见 `scripts/version-audit-allowlist.txt`）。
  **发布顺序是：先改版本号并合并 → 再打 tag → 再 push tag。**

## 4. 已发布的版本不可修改、不可复用

- 同一个版本号只发布一次。要修就发新版本号，不回头改旧版本号的代码。
- 不用更低的版本号重新发布（已发布 `v1.11.0` 后再发 `v1.11.0-rc.1` 不允许）。
- 预发布与构建元数据按规范写作 `1.12.0-rc.1`、`1.12.0+20261003`；版本优先级比较时忽略
  构建元数据。预发布版用于外部试用，正式版仍然是纯 `X.Y.Z`。

## 5. CI 门禁

`.github/workflows/release.yml` 在打包之前先跑 `scripts/version_gate.py`，
**几十秒内失败**，不必等 `npm ci` + lint + test + build 全跑完。检查项：

| 级别 | 检查 | 拦截什么 |
| --- | --- | --- |
| 阻断 | 版本号格式合法 | `1.2`、`1.02.0` |
| 阻断 | tag 与 `theme.json` 版本号一致 | 手滑打错 tag |
| 阻断 | `package.json` 与 `theme.json` 版本号一致 | 只改了一处 |
| 阻断 | 版本号严格大于所有已发布版本 | 版本号回退、复用、事后补预发布号 |
| 阻断 | 区间内有 `feat` 提交却只升 PATCH | v1.9.1 那类「新功能发补丁版」 |
| 阻断 | 区间内有破坏性提交却没升 MAJOR | 见第 2 节 |
| 阻断 | 历史审计：有版本号被写进代码却从未打 tag | 版本序列出现空洞 |
| 告警 | tag 已存在且是 HEAD 祖先 | 同一 tag 重复发布（合法重跑，不拦） |
| 告警 | 0.y.z 期间的提交类型不匹配 | 本项目已是 1.x，不适用 |

**逃生阀**：`workflow_dispatch` 的 `gateMode` 参数可选 `strict`（默认）/ `warn` / `off`。
`warn` 把阻断项降级为告警并继续发布，`off` 整个跳过。tag push 触发时恒为 `strict`。
真要用 `warn` 或 `off`，请在 PR 里写清原因——它会让已经写进用户设备的版本号不一致。

### 本地先跑一遍

```bash
python3 scripts/version_gate.py \
  --tag v1.13.1 \
  --version-file theme.json:version \
  --version-file package.json:version \
  --check-commits

# 历史审计（CI 里 strict 模式会跑）
python3 scripts/version_gate.py \
  --audit-history theme.json:version \
  --audit-allowlist scripts/version-audit-allowlist.txt
```

### 豁免机制

`scripts/version-audit-allowlist.txt` 每行一个版本号，用于把**已确认的既成欠账**降级为告警，
门禁只拦新出现的欠账。新增一行前请在文件里写清来由——这个清单会长期留在仓库里。

## 6. 发布流程速查

```bash
# 1. 本地门禁全过（0. 版本门禁 → tsc -b → oxlint → vitest ×2 → vite build）
# 2. 改 package.json 与 theme.json 的版本号，提交并推送
# 3. 打 annotated tag，再推 tag —— tag 一到，CI 自动开跑
git -c user.name=ipevel -c user.email=ipevel@users.noreply.github.com tag -a v1.13.1 -m "v1.13.1"
git push origin HEAD --tags
# 4. Release 出来后，把 theme.tar.gz 拉回来跑 scripts/verify18.py 回归发布包本身
```

## 7. 相关文档

- [README.md](README.md) —— 主题说明、字段回退表、旗帜 sprite
- [scripts/version_gate.py](scripts/version_gate.py) —— 门禁实现
- [scripts/version-audit-allowlist.txt](scripts/version-audit-allowlist.txt) —— 历史欠账豁免清单
