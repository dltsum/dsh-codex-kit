# DSH 手机远程控制桥

这是一个本地优先的电脑端桥接器。Android 客户端通过 HTTP 局域网连接到它，桥接器再以固定的
`dsh --profile skillopt-headless <task>` 子进程执行任务。它不是远程 Shell，也不会读取、上传或
复制 DSH 的 provider 凭据。

桥接器使用“启动它的电脑进程当前目录”作为 DSH 会话工作目录；请先 `Set-Location` 到你要控制的
仓库再启动。协议不接受手机传来的 `cwd`，因此手机不能把桥接器指向另一个任意目录。

## 启动

在 `dsh-codex-kit` 根目录执行：

```powershell
# 最安全：只允许同一台电脑上的客户端访问
node .\remote\bridge.mjs
```

手机访问电脑时，必须明确开启局域网监听：

```powershell
# 仅在可信家庭/办公 LAN 或已加密的 VPN（例如 Tailscale）内使用
node .\remote\bridge.mjs --host 0.0.0.0 --port 8787 --allow-lan
```

启动时终端会显示一次随机配对令牌。令牌只驻留在桥接进程内存中，不写入文件、日志或仓库。
若需要固定令牌，应使用环境变量而不是命令行参数，以免进入 Shell 历史：

```powershell
$env:DSH_REMOTE_PAIRING_TOKEN = '<至少16字符的本地配对令牌>'
node .\remote\bridge.mjs --host 0.0.0.0 --allow-lan
```

如果电脑上有多个 DSH 安装，可显式指定 DSH 可执行文件（Windows 推荐指定 `bin.js` 的绝对路径）：

```powershell
node .\remote\bridge.mjs --dsh-bin 'C:\path\to\node_modules\@deepseek-ai\dsh\lib\bin.js'
```

桥接器不会自动开防火墙端口。需要开放端口时，只允许局域网网段，并在使用后关闭规则；不要做
端口转发或把它暴露到公网。当前传输是局域网 HTTP 明文，未实现 TLS；不可信网络请使用 VPN 或
SSH 隧道，不能把手机令牌当作 TLS 的替代品。

## 手机端配对

在 [../mobile/README.zh-CN.md](../mobile/README.zh-CN.md) 中构建 Android 客户端后：

1. 在电脑上执行 `ipconfig`，找到与手机同一网络的 IPv4 地址。
2. 在 App 填入该地址、端口 `8787` 和启动时显示的配对令牌。
3. 点“连接”。成功后 App 只在内存中保存短期 session token；重启桥接器或 App 都需要重新配对。
4. 提交任务后 App 轮询任务状态；输出过长时，桥接器只保留尾部并明确标记 `output_truncated=true`。

## 受限 API

除健康检查外都需要 `Authorization: Bearer <session_token>`。所有 JSON 响应都包含统一的
`status`、`summary`、`next_actions`、`artifacts` 字段；错误不会返回堆栈、环境变量或凭据。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/v1/health` | 检查桥接器是否可达，不泄露配对信息 |
| `POST` | `/v1/pair` | 一次性令牌换取内存 session；请求体 `{"token":"..."}` |
| `GET` | `/v1/status` | 桥接器容量和有限任务历史 |
| `GET` | `/v1/tasks` | 列出有限任务历史（不返回完整输出） |
| `POST` | `/v1/tasks` | 提交 `{ "task":"...", "code":false }`；任务最多 16,000 字符 |
| `GET` | `/v1/tasks/{id}` | 查询状态和有界输出尾部 |
| `POST` | `/v1/tasks/{id}/cancel` | 请求取消任务 |
| `DELETE` | `/v1/tasks/{id}` | 同上，便于命令行客户端使用 |

桥接器默认最多并行 4 个任务、每个任务 30 分钟、保存最多 32 条历史。`code=true` 只是在子进程
中显式设置 `DSH_TOOLS_MODE=code`，不会绕过 DSH 的 profile 或开放任意工具。

## 命令行自测

以下示例只适用于桥接器已经在本机启动，并且把令牌换成终端显示的值：

```powershell
$pair = Invoke-RestMethod http://127.0.0.1:8787/v1/pair -Method Post `
  -ContentType 'application/json' -Body '{"token":"<TOKEN>"}'
$headers = @{ Authorization = "Bearer $($pair.session_token)" }
Invoke-RestMethod http://127.0.0.1:8787/v1/status -Headers $headers
$job = Invoke-RestMethod http://127.0.0.1:8787/v1/tasks -Method Post -Headers $headers `
  -ContentType 'application/json' -Body '{"task":"检查当前测试并给出摘要","code":false}'
Invoke-RestMethod "http://127.0.0.1:8787/v1/tasks/$($job.id)" -Headers $headers
```

不要把真实令牌、session token、模型输出或本机绝对路径复制到 issue、截图、Git 提交或公开日志。
