# DSH Android 手机控制端

这是配套 `remote/agent.mjs` 与 `remote/relay-server.mjs` 的 Android 客户端源码。首次设置推荐用蓝牙在
电脑旁边自动读取中继地址、设备 ID 和手机令牌；真正的互联网操作仍通过 HTTPS 中继连接电脑 Agent。
同一 LAN 的 `remote/bridge.mjs` 直连仅用于测试。App 只做四件事：
连接并配对、查看状态、提交固定的 `skillopt-headless` 任务、轮询输出和取消任务。session token 只保存在
进程内存；没有账号体系、后台常驻服务、任意 Shell、文件上传或凭据存储。

电脑 Agent 的工作目录就是它启动时的电脑当前目录。要控制某个仓库，请先在该仓库根目录启动 Agent；
App 没有远程切换目录的功能。

## 当前交付边界

- 已完成：Flutter 分层源码（domain/data/repository/MVVM UI）、HTTP 协议客户端、配对表单、任务列表、
  输出查看、Code Mode 开关、取消按钮、模型与 ViewModel 单元测试。
- 已完成：BLE Central 自动配对流程（扫描固定 DSH GATT 服务、请求挑战、接收一次性中继信息、自动切换
  HTTPS API）；手工 HTTPS 和局域网模式仍保留为明确回退。
- 已完成：Android Manifest overlay，声明网络权限，并允许本地直连测试；互联网模式使用 HTTPS，不需要
  放开电脑入站端口。
- 需在有工具的机器完成：Flutter 工程生成、`flutter analyze`、`flutter test` 和 APK 编译。
  当前开发环境没有 `flutter`、Gradle 或 Android SDK，因此不能诚实地声称已经生成 APK。

## 一键生成 Android 工程

先安装 Flutter stable、Android SDK Platform 37/Build Tools，并接受许可证（`permission_handler 13.0.1`
要求 Android compileSdk 至少 37；本仓库固定 `flutter_blue_plus 2.3.12`）：

```powershell
flutter doctor
```

Windows 在本目录执行：

```powershell
.\bootstrap.ps1
flutter build apk --release
```

macOS/Linux：

```bash
sh ./bootstrap.sh
flutter build apk --release
```

`bootstrap` 会在缺少平台工程时执行 `flutter create --platforms=android --org com.dshcodexkit .`，
把生成的 Android app compileSdk 提升到至少 37，再覆盖 Manifest overlay、拉取 SDK 依赖并运行分析和测试。
它不会接触 DSH_HOME、API key、PAT 或
任何已有凭据。生成的 APK 位于 `build/app/outputs/flutter-apk/app-release.apk`。

源码默认把 `flutter_blue_plus 2.3.12` 的连接许可类型设为 `License.nonprofit`（个人、教育和非营利使用）。如果
你把 App 用于营利业务，请先阅读该依赖的许可证并在 `BluetoothBootstrapService(license: License.commercial)`
中显式改成适用的商业许可；这与 DSH Codex Kit 自身的 MIT 许可是两件事。

## 互联网连接流程（推荐）

1. 在一台有公网 HTTPS 的 VPS/云主机上运行 `remote/relay-server.mjs`，并设置
   `DSH_RELAY_ADMIN_TOKEN`。中继建议放在 Caddy/Nginx/云负载均衡器后面，完整命令见
   [`../remote/README.zh-CN.md`](../remote/README.zh-CN.md)。
2. 在目标电脑的仓库目录运行 `remote/agent.mjs --bluetooth`，设置 `DSH_RELAY_URL`、设备 ID、Agent
   令牌、手机配对令牌；首次注册时额外设置管理员令牌。先执行根目录的
   `npm run remote:bluetooth-install` 安装可选 BLE 外设依赖。Agent 会主动出站轮询，不需要家庭路由器端口转发。
3. 手机 App 选择“蓝牙自动配对（推荐）”，允许“附近的设备”权限并接受系统配对提示。手机会扫描电脑
   的一次性 DSH GATT 服务，自动读取 `https://` 中继地址、设备 ID 和手机令牌；蓝牙交换完成后立即断开。
4. 配对后手机通过 HTTPS 中继提交任务。手机请求只会进入该设备的固定 `status/list/submit/get/cancel`
   动作；中继不执行 DSH。蓝牙不负责离开近距离后的持续连接。

如果电脑蓝牙适配器不支持 Peripheral/GATT Server，或公司策略禁止 BLE 外设，选择“互联网 HTTPS 中继
（手动回退）”并填写地址、设备 ID、手机令牌即可。这个回退不降低互联网传输安全性，只是把首次信息改为
手工输入。

## 局域网直连测试

1. 在电脑端运行桥接器（仅同一可信 LAN）：

   ```powershell
   node ..\remote\bridge.mjs
   ```

2. 手机与电脑在同一可信 LAN 时，才使用：

   ```powershell
   node ..\remote\bridge.mjs --host 0.0.0.0 --port 8787 --allow-lan
   ```

3. 用 `ipconfig` 找到电脑的 LAN IPv4 地址，在 App 选择“局域网直连（测试）”，填入 IP、`8787` 和终端显示的配对令牌。
4. 连接后提交自然语言任务；App 每秒轮询状态，输出过长时会显示“仅显示尾部”。
5. 只在确实需要代码工具时打开 Code Mode；取消按钮只取消当前 DSH 子进程，不会删除 spill、metrics 或工作文件。

## 易错点与限制

- `127.0.0.1` 对手机来说是手机自己，不是电脑。局域网测试必须填电脑 LAN IP；电脑端必须显式 `--allow-lan`。
- 蓝牙不是“把电脑变成互联网服务器”。它只在电脑旁边传递一次性中继信息；真正的远程控制仍需要可从
  手机访问的 HTTPS 中继（或你自己维护的 VPN）。
- 蓝牙配对窗口默认只有 120 秒、成功后只用一次。窗口过期或手机切到后台导致连接中断时，在电脑重新运行
  `node remote/agent.mjs --bluetooth`，不要把旧响应或旧手机令牌复制到别的设备。
- Android 12+ 会请求“附近的设备”权限；Android 11 及更早版本通常还需要位置权限才能扫描 BLE。拒绝后
  App 会明确报错，不会静默降级为未加密连接。
- 互联网模式必须填写 HTTPS 中继地址。不要在 App 中填写 `http://`，不要把电脑 8787 或中继 8788 端口直接
  暴露到公网；公网入口应由 HTTPS 反向代理或 TLS 证书保护。
- Android Manifest 仍允许 cleartext，是为了兼容局域网直连测试；互联网模式不会使用明文中继。需要跨不可信
  网络时，使用 HTTPS 中继或 Tailscale/SSH 隧道，不要把配对令牌当作 TLS。
- Windows 防火墙可能拦截 8787；只允许 Private/家庭网络的入站规则，完成后关闭，不要开放 Public profile。
- 中继重启或设备重新注册后，手机 session 失效；Agent 普通重启会重新认证但不会自动清除手机 session。
  App 重启后也需要重新配对。设备令牌和 session 不写入 App 本地存储。
- 输出和任务历史只在电脑 Agent 内存保留，最多 32 条；Agent 退出后不提供历史恢复。
- 中继会看到转发的任务文本和输出，因此应自托管或选择你信任的主机；它不应接收 DSH provider 凭据。
- 这是控制自己电脑上 DSH 的操作界面，不是远程桌面或开放给陌生人的多用户服务。

## 手工验证

```powershell
flutter analyze
flutter test
flutter build apk --debug
```

同时在电脑端运行 Agent，在中继主机用 `GET /v1/health` 检查可达，再用手机完成一次真实配对和一个
低风险只读任务。先确认 Agent 日志、任务状态和输出均符合预期，再执行会修改文件的任务。若出现
“没有最终响应”，不要自动重发原任务，先回到任务列表确认电脑是否已经执行。
