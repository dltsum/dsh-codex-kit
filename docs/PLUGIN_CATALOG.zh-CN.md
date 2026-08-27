# 可选插件清单

数据快照：2026-08-28。机器可读源是 [`config/plugins.catalog.json`](../config/plugins.catalog.json)。`unpackedBytes` 来自当日 `npm view`，不是安装后的磁盘总量；依赖、缓存和原生构建会使实际体积更大。

| id | 固定版本 | 类型 | 包体快照 | 主要权限/风险 | 默认 |
|---|---:|---|---:|---|---|
| `find` | 0.3.7 | 插件发现 | 108832 B | GitHub 公共搜索联网 | 不装 |
| `themes` | 0.2.0 | 主题 UI | 81936 B | Web UI 扩展 | 不装 |
| `modlens` | 3.25.2 | 多模态/OCR | 677267 B | 图片处理；端点取决于配置 | 不装 |
| `vision` | 3.11.1 | 视觉 Sidecar | 546284 B | 图片外发、外部模型/本地 CLI 凭据 | 不装 |
| `vision-bridge` | 0.1.0 | Gemini 视觉桥 | 31083 B | 图片发往配置的 Google 端点 | 不装 |
| `memory` | 0.1.29 | 自动 Memory | 404618 B | 持久写入、自动注入、额外模型调用 | 不装 |
| `teams` | 0.1.14 | 多代理 | 2780182 B | 子代理、状态、额外 Token 花费 | 不装 |
| `codex-subagent` | 0.1.1-rc.2 | 官方子代理 | 78078 B（不含依赖） | 启动 Codex、独立凭据/权限 | 不装 |
| `claude-subagent` | 0.1.1-rc.2 | 官方子代理 | 65409 B（不含依赖） | 启动 Claude Code、独立凭据/权限 | 不装 |
| `at-file` | 0.6.3 | 文件上下文 | 3485739 B | 读取用户选择的工作区文件 | 不装 |
| `context-vista` | 0.1.0 | 可观测性 | 65250 B | 读取上下文/Token 元数据 | 不装 |
| `better-sidebar` | 0.16.1 | 大型 UI | 14621082 B | 文件、终端、node-pty | 不装 |
| `workbench` | 0.1.31 | 大型工作台 | 4061928 B | 编辑、终端、node-pty | 不装 |

## 安装方法

```powershell
.\scripts\install.ps1 -SkipDsh -Profiles web `
  -Plugins @('find', 'themes') -AcceptThirdPartyRisk
```

安装大型能力前先 Dry-run：

```powershell
.\scripts\install.ps1 -SkipDsh -Profiles web `
  -Plugins @('teams', 'memory') -AcceptThirdPartyRisk -DryRun
```

## 为什么没有“全选”

多代理、Memory、视觉桥和工作台会同时扩大工具目录、依赖树、数据访问和故障面。Codex 式 Harness 的核心不是插件越多越好，而是让当前任务只暴露必要能力，并且每种能力都有明确的启用、验证和卸载路径。

社区目录与 GitHub `dsh-plugin` topic 适合发现新项目，但 star 数、榜单或“可安装”不等于安全、兼容或高质量。机器清单只自动安装经过当前快照核验并有固定 npm 版本的条目；GitHub-only 或结构未核验项目保留为 discovery-only。
