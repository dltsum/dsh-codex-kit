# DSH Codex Kit

面向本地 DeepSeek Harness（DSH）的可审计增强包：一键安装、渐进式 Skill 检索、Token 预算、轻量预设、诊断工具，以及按需下载的插件目录。

本项目当前锁定并验证 `@deepseek-ai/dsh@0.1.1-rc.2`。DSH 仍处于 developer preview，升级可能破坏兼容性，因此安装器不会跟随 `latest`，而是显式固定版本。

## 它解决什么问题

DSH 官方 `tool-skill` 会把每个可调用 Skill 的名称和说明作为完整目录放进上下文，然后再按精确名称加载正文。Skill 数量多时，目录本身会在每一步重复消耗上下文。DSH Codex Kit 的轻量模式会：

1. 禁用该预设中的完整 Skill 目录；
2. 保留一个稳定、很小的 `skillopt` 工具；
3. 用本地确定性检索从任务描述中找出少量候选；
4. 仅在选中后，通过官方 `ctx.skills.get()` 加载原始完整 Skill；
5. 不重写、不摘要、不覆盖任何 `SKILL.md`。

检索结果中的“节省 Token”是与目录字符数有关的本地估算，不是账单或模型 tokenizer 的实测值。项目没有宣称任务质量一定提升；基准协议见 [docs/BENCHMARK.md](docs/BENCHMARK.md)。

这里的“自动”指轻量 Preset 自动换掉全目录，并通过工具说明让 Agent 在适用任务上自行调用 `search -> load`；没有隐藏的后台模型调用，也不会在每轮偷偷改写提示词。若 Agent 没有调用，可以直接要求“先用 skillopt 查找适合的 Skill”。

## 快速安装

要求：Node.js `22.19+` 或 `24+`、Git、npm。安装器会在缺少 pnpm 时安装固定版本 `pnpm@11.7.0`。

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

默认动作只有：安装固定版 DSH、小型 Kit、Web 的 `skillopt-standard` 用户预设，以及 Headless 的 `skillopt-headless` 配置。不会下载插件目录中的任何第三方大插件，也不会启动浏览器、Web 服务或模型请求。

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

然后由你手动打开 `http://127.0.0.1:3080`，在新会话选择“SkillOpt 轻量模式”。安装器不控制浏览器。

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
```

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

- 不读取、复制或提交 API Key、DSH `settings.yaml`、会话、Memory、模型或缓存。
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

## 卸载

```powershell
.\scripts\uninstall.ps1 -DryRun
.\scripts\uninstall.ps1
```

卸载器只移除本 Kit、带本项目所有权标记的生成预设/Headless Profile；不会删除 DSH，也不会替你删除第三方插件。删除前仍会备份配置清单。

## 许可证

MIT。DSH 和各第三方插件分别遵循其自身许可证。
