# DSH Codex Kit

面向本地 DeepSeek Harness（DSH）的可审计增强包：一键安装、渐进式 Skill 检索、固定能力档位、无损工具输出预算、无内容本地效率账本、诊断工具，以及按需下载的插件目录。

本项目 `0.3.0` 当前锁定并验证 `@deepseek-ai/dsh@0.1.1-rc.2`。DSH 仍处于 developer preview，升级可能破坏兼容性，因此安装器不会跟随 `latest`，而是显式固定版本。

## 它解决什么问题

DSH 官方 `tool-skill` 会把每个可调用 Skill 的名称和说明作为完整目录放进上下文，然后再按精确名称加载正文。Skill 数量多时，目录本身会在每一步重复消耗上下文。DSH Codex Kit 的轻量模式会：

1. 禁用该预设中的完整 Skill 目录；
2. 保留一个稳定、很小的 `skillopt` 工具；
3. 用本地确定性检索从任务描述中找出少量候选；
4. 仅在选中后，通过官方 `ctx.skills.get()` 加载原始完整 Skill；
5. 不重写、不摘要、不覆盖任何 `SKILL.md`。

`0.3.0` 还生成四个稳定入口：Web 的 `skillopt-standard`、`skillopt-code`、`skillopt-minimal`，以及命令行的 `skillopt-headless`。每个 Web Preset 都从同版 DSH 随附的官方 Preset 精确复制，能力面不会在会话间随机变化。

对超出预算的纯文本工具结果，Kit 先通过 DSH 官方 `spillStore` 原样保存完整内容，再把有明确 `status / summary / next_actions / artifacts` 的有界预览交给模型。它不会用截断结果冒充完整结果。另有本地 JSONL 效率账本，只记录 Token 数、字节数、耗时、状态码和不可逆短哈希；不记录提示词、模型输出、工具参数/结果、路径或凭据，也不向远端上传。

检索结果中的“节省 Token”是与目录字符数有关的本地估算，不是账单或模型 tokenizer 的实测值。项目没有宣称任务质量一定提升；基准协议见 [docs/BENCHMARK.md](docs/BENCHMARK.md)。

这里的“自动”指轻量 Preset 自动换掉全目录，并通过工具说明让 Agent 在适用任务上自行调用 `search -> load`；没有隐藏的后台模型调用，也不会在每轮偷偷改写提示词。若 Agent 没有调用，可以直接要求“先用 skillopt 查找适合的 Skill”。

## 一键安装

要求：Node.js `22.19+` 或 `24+`、Git、npm。安装器会在缺少 pnpm 时安装固定版本 `pnpm@11.7.0`。

### 全功能推荐包

这是面向本地工作站的推荐入口：保留 SkillOpt 轻量优化，同时安装视觉、多模态、自动 Memory、多代理、官方 Codex/Claude 子代理、文件上下文、Token 可观测性、主题和 Workbench。大型插件不在仓库或 ZIP 中，只在执行脚本时从固定版本下载。

Windows PowerShell：

```powershell
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
Set-Location .\dsh-codex-kit
powershell -ExecutionPolicy Bypass -File .\install-full.ps1
```

macOS / Linux：

```bash
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
cd dsh-codex-kit
sh ./install-full.sh
```

先演练完整安装、不写入：

```powershell
.\install-full.ps1 -DryRun
```

执行 `install-full` 本身就是对机器清单中固定第三方插件集合的明确选择；它不会捆绑或填写任何模型/API 凭据。Gemini 专用 `vision-bridge` 与会重叠 Workbench 的 `better-sidebar` 留作手动替代项，不在推荐集合中。

### 仅安装核心优化

Windows PowerShell：

```powershell
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
Set-Location .\dsh-codex-kit
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS / Linux：

```bash
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
cd dsh-codex-kit
sh ./scripts/install.sh
```

核心入口只安装固定版 DSH、小型 Kit、Web 的三个固定能力预设，以及 Headless 的 `skillopt-headless` 配置。不会下载插件目录中的任何第三方大插件，也不会启动浏览器、Web 服务或模型请求。

先演练、不写入：

```powershell
.\scripts\install.ps1 -DryRun
```

```bash
sh ./scripts/install.sh --dry-run
```

## 使用

Web：

```powershell
dsh web --no-open
```

然后由你手动打开 `http://127.0.0.1:3080`，在新会话选择其一：

- “SkillOpt 轻量标准模式”：日常通用，官方完整原生工具面；
- “SkillOpt 代码模式”：固定官方 Code Mode 工具面；
- “SkillOpt 极简模式”：官方最小双工具组，常驻开销最低、能力也最少。

安装器不控制浏览器。为了工具集合、缓存与复现稳定，不要在已有消息的会话中切换能力档位。

Headless：

```powershell
dsh --profile skillopt-headless "检查这个仓库的测试问题"
```

或：

```powershell
dsh-kit run "检查这个仓库的测试问题"
```

Code Mode 是可选项，不默认打开：

```powershell
dsh-kit run --code "检查这个仓库的测试问题"
```

诊断：

```powershell
dsh-kit doctor --deep
dsh-kit catalog
dsh-kit metrics
dsh-kit metrics --json
```

`metrics` 只汇总最近一份 `$DSH_HOME/metrics/dsh-codex-kit/*.jsonl`。必须用相同模型、任务和缓存状态的基线对照后，才能据此声称优化有效。

## 按需安装插件

先查看 [插件目录](docs/PLUGIN_CATALOG.zh-CN.md) 的权限、体积和数据去向。任何第三方插件都必须显式选择并确认风险：

```powershell
.\scripts\install.ps1 `
  -SkipDsh `
  -Profiles web `
  -Plugins @('modlens', 'context-vista') `
  -AcceptThirdPartyRisk
```

大型工作台、视觉桥、自动记忆、多代理等均不会进入本仓库，也不会被默认下载；只有执行带对应插件 id 的安装命令时，DSH 才会从固定 npm 版本下载它们。

## 安全边界

- 不读取、复制或提交 API Key、DSH `settings.yaml`、会话、Memory、模型、缓存、spill 文件或本地效率账本。
- 不用 `curl | sh`、`irm | iex` 这类不可审计的一行远程执行方式。
- 更新由本项目生成的预设/配置前先放入 `$DSH_HOME/backups/dsh-codex-kit/`；遇到同名但无所有权标记的目录会拒绝覆盖。
- 第三方插件是宿主进程代码，不等同于受限的普通 Skill。安装前必须检查源码、版本、权限和卸载路径。
- 公开仓库检查会阻止常见密钥格式、本机操作者路径和大于 2 MiB 的文件。

完整的外行手册、命令、易错点和恢复流程见 [docs/INSTALLATION.zh-CN.md](docs/INSTALLATION.zh-CN.md)。研究依据见 [docs/research/SOURCES.md](docs/research/SOURCES.md)。

## 开发与验证

```powershell
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm run pack:dry
```

## Android 手机远程控制（互联网中继）

仓库现在包含 Android 控制端、电脑端 Agent 和自托管 HTTPS 中继。手机通过互联网访问中继；电脑
Agent 主动出站连接并在本机运行固定的 `skillopt-headless` DSH 任务，因此不需要给电脑开放公网入站
端口。中继不提供任意 Shell、文件上传或凭据读取接口。

中继主机（建议放在 HTTPS 反向代理后）：

```bash
export DSH_RELAY_ADMIN_TOKEN='<中继管理员令牌>'
node remote/relay-server.mjs --host 0.0.0.0 --port 8788 --allow-public --behind-proxy
```

目标电脑在仓库目录启动 Agent：

```powershell
$env:DSH_RELAY_URL = 'https://relay.example.com'
$env:DSH_RELAY_ADMIN_TOKEN = '<中继管理员令牌>'
$env:DSH_RELAY_DEVICE_ID = 'office-pc'
$env:DSH_RELAY_AGENT_TOKEN = '<电脑 Agent 令牌>'
$env:DSH_RELAY_PHONE_TOKEN = '<手机配对令牌>'
node .\remote\agent.mjs --bluetooth
```

首次使用蓝牙时先运行 `npm run remote:bluetooth-install` 安装可选 BLE 外设依赖。手机 App 选择“蓝牙
自动配对（推荐）”，在电脑旁允许“附近的设备”权限并接受系统配对提示；中继地址、设备 ID 和手机令牌
会自动通过一次性安全 GATT 交换，不需要手填。蓝牙只负责首次引导，离开范围后仍通过 HTTPS 中继控制。
若适配器不支持 BLE Peripheral/GATT Server，再选择“互联网 HTTPS 中继（手动回退）”填写三项信息。局域网
`remote/bridge.mjs` 仅保留作本地测试，禁止将其 HTTP 端口转发到公网。部署、协议、构建和实施状态见
[`remote/README.zh-CN.md`](remote/README.zh-CN.md)、[`mobile/README.zh-CN.md`](mobile/README.zh-CN.md) 和
[`docs/REMOTE_APP_IMPLEMENTATION_PLAN.zh-CN.md`](docs/REMOTE_APP_IMPLEMENTATION_PLAN.zh-CN.md)。

## 卸载

```powershell
.\scripts\uninstall.ps1 -DryRun
.\scripts\uninstall.ps1
```

卸载器只移除本 Kit、带本项目所有权标记的生成预设/Headless Profile；不会删除 DSH，也不会替你删除第三方插件。删除前仍会备份配置清单。为避免再次误删工作证据，卸载器也不会删除 spill 完整输出或本地效率账本；如需清理，先人工核对目录再单独处理。

## 许可证

MIT。DSH 和各第三方插件分别遵循其自身许可证。
