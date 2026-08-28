# DeepSeek Harness 本地安装与使用手册：八个方面

适用快照：2026-08-28；Kit `0.2.0`；DSH `0.1.1-rc.2`。这是一份面向外行的本地手册。所有命令默认在你自己的电脑执行，不需要服务器。服务器只有在你明确想让 DSH 远程常驻、多人访问或跑重型本地模型时才有意义，不是本方案的前提。

## 一、先理解四个名词：DSH、Profile、Preset、Plugin

把 DSH 想成一间“可拼装的工作室”：

- DSH 是总框架；
- Profile 决定宿主启动哪些插件，例如 `web` 或 `headless`；
- Agent Preset 决定某个 Web 会话可见的工具、Skill、压缩和子代理能力；
- Plugin 是在宿主进程中执行的代码；Skill 通常只是按需加载的说明文档。

最常见的错误是把 Profile 和 Preset 混为一谈。运行 `dsh web` 启动的是 Web Profile；进入页面后选择“SkillOpt 轻量模式”，选的是会话 Preset。只安装插件但不选轻量 Preset，官方完整 Skill 目录仍然会进入该会话上下文，Token 优化就没有完全生效。

本 Kit 的数据流是：

```text
用户任务 -> 一个稳定的 skillopt 工具 -> 本地检索 Skill 摘要
        -> 返回少量候选 -> 按精确名称调用官方 ctx.skills.get()
        -> 原样加载完整 SKILL.md 正文 -> 执行任务
```

它不会让服务器替你工作，也不会把 Skill 传到作者的服务器。真正的数据外发取决于你选的模型、MCP 和可选插件。

## 二、安装前检查：版本、目录和备份

### 2.1 检查 Node、npm、Git

Windows：

```powershell
node --version
npm --version
git --version
```

macOS / Linux：

```bash
node --version
npm --version
git --version
```

Node 必须是 `22.19+` 或 `24+`。不要看到 `22.x` 就认为都可以；`22.18` 比本项目要求低。部分可选插件也明确要求 `22.19`。

### 2.2 认识 DSH_HOME

默认是：

- Windows：`%USERPROFILE%\.dsh`
- macOS / Linux：`$HOME/.dsh`

查看自定义值：

```powershell
$env:DSH_HOME
```

```bash
printf '%s\n' "${DSH_HOME:-$HOME/.dsh}"
```

易错点：安装插件时用一个 `DSH_HOME`，启动时又换成另一个，结果页面里看不到插件。安装、诊断、启动必须使用同一个值。

### 2.3 先 Dry-run

```powershell
.\scripts\install.ps1 -DryRun
```

```bash
sh ./scripts/install.sh --dry-run
```

Dry-run 只展示命令。它不是完整兼容性测试，因为没有真正合成配置；真正安装后还会执行 `dsh --dump-config` 验证。

## 三、一键安装：具体命令和每一步发生什么

### 3.1 Windows：全功能推荐包

```powershell
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
Set-Location .\dsh-codex-kit
powershell -ExecutionPolicy Bypass -File .\install-full.ps1
```

### 3.2 macOS / Linux：全功能推荐包

```bash
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
cd dsh-codex-kit
sh ./install-full.sh
```

全功能入口会明确选择 `recommended-full`：SkillOpt 轻量预设、Web 与 Headless，以及固定版本的插件发现、主题、多模态、视觉、自动 Memory、Agent Teams、Codex/Claude 子代理、`@` 文件上下文、Context Vista 和 Workbench。大型内容在安装时下载，不进入本仓库或发布 ZIP。

先演练：

```powershell
.\install-full.ps1 -DryRun
```

若只要核心优化而不装第三方插件：

```powershell
.\scripts\install.ps1
```

```bash
sh ./scripts/install.sh
```

共同流程：

1. 检查 Node/npm；缺 pnpm 时装 `pnpm@11.7.0`。
2. 安装或切换到 `@deepseek-ai/dsh@0.1.1-rc.2`。
3. 把小型 Kit CLI 安装为 `dsh-kit`。
4. 用 `dsh plugin --profile web add <本地 Kit 路径>` 把 Kit 装入 Web Profile。
5. 从当前 DSH 随附的 `standard` Preset 复制出用户预设 `skillopt-standard`；从不修改官方安装目录。
6. 生成 `skillopt-headless` Profile 并装入 Kit。
7. 对每个 Profile 执行只读 `--dump-config`；找不到 Kit 就显式失败。
8. 不启动 Web、不打开浏览器、不调用模型。

如果你已经手工维护了同名目录，但里面没有 `.dsh-codex-kit.json`，安装器会停止。这不是故障，而是防止覆盖你的文件。

### 3.3 自定义安装与只装某一种入口

只装 Web：

```powershell
.\scripts\install.ps1 -Profiles web
```

只装 Headless：

```powershell
.\scripts\install.ps1 -Profiles headless
```

保留当前 DSH，不升级：

```powershell
.\scripts\install.ps1 -SkipDsh
```

易错点：`-SkipDsh` 只是跳过升级，不代表兼容性已经验证。如果你保留的是旧版，诊断会显示实际版本，出现接口错误时应先回到锁定版本。

## 四、启动与日常操作：Web、Headless、SkillOpt

### 4.1 Web

```powershell
dsh web --no-open
```

终端显示地址后，你自己在浏览器打开 `http://127.0.0.1:3080`。新建会话时选“SkillOpt 轻量模式”。不要在已经产生消息的会话中来回切 Preset：工具集合和提示结构变化会让复现、缓存和审计变困难。

### 4.2 Headless

```powershell
dsh --profile skillopt-headless "阅读当前仓库并解释测试失败原因"
```

或：

```powershell
dsh-kit run "阅读当前仓库并解释测试失败原因"
```

### 4.3 SkillOpt 的三个动作

模型看到一个 `skillopt` 工具：

- `search`：按任务查候选；
- `load`：按精确名称加载一个完整 Skill；
- `stats`：看当前目录规模和估算占用。

“自动”不是后台再跑一个收费模型，而是轻量 Preset 自动去掉全目录，当前 Agent 根据 `skillopt` 的工具说明决定何时执行 `search -> load`。这保持了工具集合稳定，也避免每轮注入动态候选。如果某个模型工具选择较弱，明确告诉它“先用 skillopt 搜索再加载”即可；这属于模型能力差异，不能用静默兜底掩盖。

概念示例：

```json
{"action":"search","query":"审查 JavaScript 安全问题","limit":5,"tokenBudget":600}
```

得到候选后：

```json
{"action":"load","name":"code-review"}
```

易错点：不能把搜索摘要当作 Skill 正文。必须 `load` 后才按完整说明执行。没有检索结果时，系统返回空列表并建议扩展查询，不会随便挑一个凑数。

## 五、插件与多模态：怎么选、怎么装、哪里有风险

先列目录：

```powershell
dsh-kit catalog
```

例如只安装 ModLens 与 Context Vista：

```powershell
.\scripts\install.ps1 `
  -SkipDsh `
  -Profiles web `
  -Plugins @('modlens', 'context-vista') `
  -AcceptThirdPartyRisk
```

为什么要多一个 `AcceptThirdPartyRisk`？因为 Plugin 是宿主代码，可能读文件、启动进程、联网、使用凭据或增加模型花费。这个开关只是确认你读过清单，不会让插件自动变安全。

多模态尤其容易误解：DeepSeek 文本模型本身不会因为装了 UI 就突然获得像素输入。常见插件是把图片发给另一个视觉模型，得到文字证据后再交给 DeepSeek。必须确认：

1. 图片发给哪个端点；
2. 使用哪个 API Key；
3. 是否保存图片/识别结果；
4. 最大图片数量与字节数；
5. 文字模型看到的是原图还是二次转录。

核心入口不预装视觉桥、自动 Memory、多代理、Workbench、Better Sidebar。全功能入口明确安装推荐集合，但仍排除两个重叠替代项：Gemini 专用 `vision-bridge` 和与 Workbench 职责重叠的 `better-sidebar`。它们只有手动点名才下载。详细清单见 [PLUGIN_CATALOG.zh-CN.md](PLUGIN_CATALOG.zh-CN.md)。

## 六、Token 与性能优化：什么真的做了，什么只是实验

### 6.1 默认启用

- 全目录改为按需检索；
- 目录索引只在进程内缓存，目录摘要变化后哈希改变；
- 不完整的远程目录快照不进入缓存；
- 结果有 `limit` 和 `tokenBudget` 双重上限；
- `SKILL.md` 正文原样加载；
- 轻量预设把单个指令批次上限从 65536 收到 32768 字节；
- 工具结果超过阈值时保留头尾并裁剪中部，轻量值为 6144/3072/1024 字符。

降低上限会减少上下文，但也可能丢掉重要中段。重要证据应写入文件或让工具返回短小结构化结果，不能依赖超长终端输出一直留在对话里。

### 6.2 可选 Code Mode

```powershell
dsh-kit run --code "运行测试并总结失败"
```

Code Mode 可以减少大量原生工具 Schema 的重复暴露，但不同模型/Provider 的兼容性不一致，所以不是默认值。先用小任务对比正确率、失败率、输入 Token 和延迟。

### 6.3 明确没有默认做的事

- 没有用模型自动重写/压缩 Skill 正文；
- 没有安装 embedding 模型或向量库；
- 没有在运行中动态注册/注销大量工具；
- 没有承诺论文中的节省比例能直接复制到你的 DSH；
- 没有伪装成模型 tokenizer 的精确计费器。

LLMLingua-2 等方法说明模型化的抽取压缩可能有价值，但它需要额外模型、评测和保真验证。对命令、安全规则、版本和权限进行无验证压缩，风险高于收益，因此只保留为研究方向。

## 七、诊断、易错点与恢复

### 7.1 一条诊断命令

```powershell
dsh-kit doctor --deep
```

它检查 Node、npm、pnpm、dsh、生成标记，并在 Headless Profile 存在时做配置合成。不会调用模型。

### 7.2 常见问题

“Web 里找不到 SkillOpt”：

```powershell
dsh --profile web --dump-config | Select-String dsh-codex-kit
Get-ChildItem "$env:USERPROFILE\.dsh\.agent-presets\skillopt-standard"
```

确认启动使用同一个 `DSH_HOME`，重启 DSH，创建新会话，再选 Preset。

“插件装了但没启用”：安装包只解决 Profile 依赖和 bundle；部分能力还需要 Preset 中的工具行。官方 Codex/Claude 子代理只有在安装器明确选中对应 id 时才会在生成 Preset 中去掉 `disabled: true`。

“长会话突然 context overflow”：先把关键结果落盘，再开新会话或显式 compact；不要仅调大 `maxTokens`。输入窗口和最大输出预算相加可能超过模型窗口，论坛已有类似复现。轻量预设只能降低压力，不能修复所有上游边界问题。

“更新后预设仍是旧行为”：用户 Preset 是复制快照，不会随 DSH 自动刷新。重新运行安装器，它会从新 DSH 的 shipped `standard` 复制并做精确锚点修改；上游结构对不上时会失败，不会猜测打补丁。

### 7.3 卸载与恢复

```powershell
.\scripts\uninstall.ps1 -DryRun
.\scripts\uninstall.ps1
```

卸载前的配置备份在：

```text
$DSH_HOME/backups/dsh-codex-kit/
```

卸载不碰 DSH 和第三方插件。若你想移除某个可选插件：

```powershell
dsh plugin --profile web remove <package-name>
```

使用清单中的 `package` 字段，不要拿展示 id 盲猜包名。

## 八、升级、生态、论坛和公开发布

DSH 官方明确说 developer preview 会有兼容性破坏。建议升级流程：

```powershell
git pull --ff-only
npm view @deepseek-ai/dsh dist-tags time --json
.\scripts\install.ps1 -DryRun
.\scripts\install.ps1
dsh-kit doctor --deep
```

然后运行：

```powershell
npm run check
npm run pack:dry
```

生态入口：

- 官方仓库、文档和 GitHub Discussions；
- GitHub `dsh-plugin` topic；
- 社区目录只用于发现，不是安全背书；
- npm 的 `latest` 与 `next` 可能不同，尤其是预览版官方子代理；本项目使用完整版本号。

公开推送前：

```powershell
npm run check:public
git status --short
git diff --check
git ls-files
```

确认没有 `.env`、`settings.yaml`、凭据、会话、Memory、模型、大插件、压缩包和本机路径。Git 远程 URL 不要内嵌 PAT；使用凭据管理器或 GitHub CLI 的交互式登录，并为公开仓库启用 Secret Scanning。

研究、论坛问题与论文的完整链接见 [research/SOURCES.md](research/SOURCES.md)。
