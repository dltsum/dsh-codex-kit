# DSH 手机远程控制桥

`remote/bridge.mjs` 是本地优先的电脑端桥接器：Android 客户端通过 HTTP 局域网连接到它，桥接器
再以固定的 `dsh --profile skillopt-headless <task>` 子进程执行任务。它不是远程 Shell，也不会读取、
上传或复制 DSH 的 provider 凭据。需要跨互联网操作时，使用下方的 HTTPS 中继和出站 Agent，而不是
把这个局域网端口直接发布到公网。

桥接器使用“启动它的电脑进程当前目录”作为 DSH 会话工作目录；请先 `Set-Location` 到你要控制的
仓库再启动。协议不接受手机传来的 `cwd`，因此手机不能把桥接器指向另一个任意目录。

## 互联网模式（推荐）

局域网直连只适合测试。要让手机在外网控制电脑，使用本仓库的三段式路径：

```text
Android App --HTTPS--> relay-server（你的 VPS/云主机/反向代理） <--HTTPS 长轮询-- agent（你的电脑）
                                                                      |
                                                                      +--> 本机 DSH
```

### 蓝牙自动配对（推荐的首次设置）

蓝牙只负责“人在电脑旁边时”的一次性引导，不是互联网通道：电脑仍然主动通过 HTTPS 长轮询连接中继，
手机离开蓝牙范围后继续通过中继控制。这样既不用让用户手填中继 URL/设备 ID/手机令牌，也不需要把电脑
端口暴露到公网。电脑的蓝牙适配器必须支持 BLE 外设/GATT Server；部分 Windows 内置或廉价适配器只支持
Central，遇到这种情况请使用下面的手工 HTTPS 配对回退。

核心 Kit 不默认安装原生 BLE 依赖。只在需要蓝牙广播的电脑上执行一次：

```powershell
npm run remote:bluetooth-install
```

该脚本把固定版本 `@stoprocent/bleno@0.11.4` 安装到当前 checkout 的 `node_modules`，不写入
`package.json` 或 lockfile，也不会把原生依赖推送到 GitHub。Linux/Windows 的适配器、驱动和 node-gyp
前置条件以该包文档为准；当前 Windows 方案可能要求兼容 BLE 4.0 适配器、WinUSB 和 node-gyp 工具链，
这可能改变该适配器的系统驱动用途。若不希望更换驱动，改用手工 HTTPS 模式。如果安装或广播失败，不要反复重试同一个未知状态，改用手工 HTTPS 模式并检查
适配器支持情况。

中继已经启动、电脑 Agent 已经注册后，在电脑执行：

```powershell
$env:DSH_RELAY_URL = 'https://relay.example.com'
$env:DSH_RELAY_ADMIN_TOKEN = '<首次注册才需要>'
$env:DSH_RELAY_DEVICE_ID = 'office-pc'
$env:DSH_RELAY_AGENT_TOKEN = '<电脑 Agent 令牌>'
$env:DSH_RELAY_PHONE_TOKEN = '<已注册的手机令牌>'
node .\remote\agent.mjs --bluetooth
```

新设备首次注册时可以省略两个设备令牌，Agent 会生成并把手机令牌只放进本次安全 GATT 响应；请把生成
的电脑令牌和手机令牌保存到本机秘密管理器，再重启时复用。已有设备若启用 `--bluetooth`，必须提供
原来注册的 `DSH_RELAY_PHONE_TOKEN`，Agent 不会为了“方便”自动轮换令牌或清掉现有会话。

手机 App 选择“蓝牙自动配对”，允许“附近的设备”权限，选择显示为 `DSH-...` 的电脑并接受系统配对提示。
电脑只广播一个随机数、设备 ID、中继地址和过期时间；手机再发一个随机挑战，电脑才在加密/配对的 GATT
特征上返回手机令牌。响应使用一次后立即停止广播，默认 120 秒过期，且协议没有任务执行、Shell 或文件
传输特征。若手机提示找不到设备，确认 Agent 仍在 120 秒窗口内、电脑蓝牙适配器支持 Peripheral/GATT
Server，并让手机靠近电脑；窗口结束后重新运行 Agent 的 `--bluetooth`。

中继不会启动 DSH，也不会收到电脑的 provider/API 凭据；它只转发受限的 `status`、`list`、`submit`、
`get`、`cancel` 动作。中继状态文件只保存设备令牌哈希，任务文本和输出只在命令等待期间留在内存。
中继主机仍能看到通过它转发的任务文本/输出，因此应使用你自己管理的主机，并把 HTTPS 终止在中继
进程或可信反向代理上。

### 1. 启动中继主机

在中继主机设置一个至少 16 字符的管理员令牌（不要写进 Git、Docker 镜像或公开日志）：

```bash
export DSH_RELAY_ADMIN_TOKEN='<管理员令牌>'
export DSH_RELAY_STATE_FILE='/var/lib/dsh-relay/state.json'
node remote/relay-server.mjs --host 0.0.0.0 --port 8788 --allow-public --behind-proxy
```

上例假设 Caddy/Nginx/云负载均衡器把 `https://relay.example.com` 反向代理到 `127.0.0.1:8788`。
若代理运行在另一台机器，防火墙只允许代理访问 8788；不要把这个明文内部端口直接发布给互联网。
若不使用反向代理，必须直接提供证书：

最小 Caddy 配置示例（Caddy 负责自动申请和续期 HTTPS 证书）：

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

```bash
node remote/relay-server.mjs --host 0.0.0.0 --port 8788 --allow-public \
  --tls-cert /etc/letsencrypt/live/relay.example.com/fullchain.pem \
  --tls-key /etc/letsencrypt/live/relay.example.com/privkey.pem
```

没有 `--allow-public` 时，服务拒绝非回环监听；没有 TLS 证书或 `--behind-proxy` 时，也拒绝把明文
HTTP 直接绑定到公网地址。管理员令牌只用于电脑 Agent 注册设备，不输入手机 App。

### 2. 在电脑启动出站 Agent

Agent 主动访问中继，不需要在家庭路由器上开放入站端口。首次注册需要管理员令牌；设备 ID、电脑
Agent 令牌和手机配对令牌建议通过环境变量提供：

```powershell
$env:DSH_RELAY_URL = 'https://relay.example.com'
$env:DSH_RELAY_ADMIN_TOKEN = '<管理员令牌>'
$env:DSH_RELAY_DEVICE_ID = 'office-pc'
$env:DSH_RELAY_AGENT_TOKEN = '<电脑 Agent 令牌>'
$env:DSH_RELAY_PHONE_TOKEN = '<手机配对令牌>'
$env:DSH_REMOTE_DSH_HOME = $env:DSH_HOME
Set-Location C:\path\to\target-repository
node .\remote\agent.mjs
```

macOS/Linux 使用同名环境变量后执行 `node remote/agent.mjs`。如果首次运行不提供后三个设备令牌，
Agent 会生成并在终端显示一次；请立即放进本机秘密管理器，再重启时复用。Agent 只把任务交给本地
固定的 `skillopt-headless` profile，`cwd` 是 Agent 启动目录，也可以通过 `DSH_REMOTE_CWD` 显式设置。

### 3. 在手机 App 配对

优先按上面的蓝牙流程选择“蓝牙自动配对”，App 会自动得到中继 HTTPS 地址、设备 ID 和手机配对令牌。
若电脑适配器不支持 BLE 外设，再选择“互联网 HTTPS 中继（手动回退）”，填写中继 HTTPS 地址、设备 ID
和 Agent 终端显示的手机配对令牌。App 会请求 `/v1/devices/{device_id}/v1/*` 命名空间；手机不需要知道电脑 IP，只访问中继的 HTTPS 入口
（通常是 443），不访问电脑的 8787 或中继内部的 8788。App 重启后重新配对即可，session 不落盘。

若中继或 Agent 断线，手机会得到明确的超时/不可用状态。不要因为“没有最终响应”就自动重发原任务：
Agent 可能已经在电脑上执行完成，先回到任务列表确认状态。

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

互联网 App 使用同一组任务动作，但会把路径放在 `/v1/devices/{device_id}` 下面，例如
`GET /v1/devices/office-pc/v1/status`；`/v1/agent/*` 只供电脑 Agent 使用，管理员令牌不应输入手机。

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
