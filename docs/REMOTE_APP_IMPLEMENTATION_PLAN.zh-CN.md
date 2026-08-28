# Android 远程控制端实施记录

更新时间：2026-08-28

## 目标与边界

把手机变成自己电脑上 DSH 的控制面板：互联网模式通过自托管 HTTPS 中继和电脑出站 Agent 访问，
局域网直连作为测试回退。手机可配对、查看有限状态、提交固定 `skillopt-headless` 任务、轮询有界输出、
取消任务。中继和桥接器都不提供任意 Shell、文件上传、插件安装、浏览器控制或凭据读取；电脑的 DSH
仍然只在本机执行。

## 已完成

- [x] 冻结 HTTP v1 协议和统一 `{status, summary, next_actions, artifacts}` 响应结构。
- [x] `remote/bridge.mjs`：一次性内存配对、Bearer session、局域网显式开关、并发/任务/输出/运行时限额、
  有界历史、取消和 Windows 非 shell 子进程启动。
- [x] `test/remote-bridge.test.mjs`：健康检查、未配对拒绝、错误令牌、一次性配对、任务轮询、超长任务、
  非法控制接口和取消路径。
- [x] `mobile/lib`：不可变 domain 模型、HTTP service、repository、ChangeNotifier ViewModel 和 Material 3 UI。
- [x] `remote/relay-server.mjs`：设备注册（只持久化令牌哈希）、HTTPS/反向代理部署防误配置、手机设备命名空间、
  出站 Agent 长轮询、命令/响应限额和超时。
- [x] `remote/agent.mjs`：电脑主动出站认证、固定动作分发到本地 Bridge、断线退避；未知响应不自动重放。
- [x] Flutter 手机端增加 HTTPS 中继模式；局域网直连保留为测试模式。
- [x] BLE 自动引导协议：电脑端可选 `--bluetooth` 广播一次性安全 GATT 服务，手机端扫描、发随机挑战、
  读取中继地址/设备 ID/手机令牌后自动进入 HTTPS 模式；令牌不出现在广播和 info 特征中。
- [x] 可选原生依赖安装脚本 `npm run remote:bluetooth-install`；核心安装和 GitHub 包不携带该依赖。
- [x] Android Manifest 的 BLE/运行时权限声明、蓝牙模式 UI、显式手工 HTTPS/LAN 回退和安全提示。
- [x] `mobile/test`：端点校验、wire 状态解析、坏响应显式失败、ViewModel 连接/提交/选择/取消。
- [x] `mobile/bootstrap.ps1` / `mobile/bootstrap.sh`：有 Flutter 时生成 Android 平台工程、覆盖网络 Manifest、
  运行 `flutter analyze` 和 `flutter test`。
- [x] 根 README、中文手册、SECURITY 和 npm 打包清单已链接手机端；新增代码不含凭据形态文本。

## 验证证据

- `npm test`：36/36 通过（含 BLE GATT fake 服务器的一次性挑战、拒绝路径和超大响应显式失败）。
- `npm run check:syntax`：32 个 JavaScript 文件通过（含 BLE Agent、协议和安装脚本）。
- `npm run check:public`：64 个文本文件通过，无已知凭据模式或超大文件。
- `npm run pack:dry`：包含 `mobile/`、`remote/` 源码、BLE 安装脚本和文档，不包含依赖、构建产物或令牌。
- 使用内存假 Agent 完成一次手机请求经中继、出站长轮询、固定动作分发和响应回传的端到端模拟。
- `node remote/bridge.mjs --host 0.0.0.0 --port 8787`：拒绝无 `--allow-lan` 的非回环监听。
- `node remote/relay-server.mjs --host 0.0.0.0 --port 8788`：拒绝无 `--allow-public` 的非回环中继监听，
  且公网直绑没有 TLS 或 `--behind-proxy` 时拒绝启动。
- 当前开发机没有 `flutter`、`dart`、Gradle 或 `adb` 命令；因此 Flutter 分析、设备测试和 APK 构建仍需在
  安装 Android 工具链的机器执行，不能标记为已完成。
- 当前开发机也未安装原生 BLE 适配器和 `@stoprocent/bleno`；已使用注入式 fake GATT 服务器测试协议边界，
  真实 Windows 适配器广播、Android 系统配对弹窗和跨互联网中继仍需在目标设备上验收。

## 待在 Android 工具链机器执行

```powershell
Set-Location .\mobile
.\bootstrap.ps1
flutter build apk --release
```

构建后先在 HTTPS 中继上做低风险只读任务的配对、轮询和取消验收，再考虑文件修改类任务。中继主机
必须由你自托管或明确受信任，设备/手机令牌不要写入仓库。电脑 Agent 与中继之间的命令响应如果在
网络故障时没有最终回执，按未知完成处理，不能自动重放原任务。局域网直连仍是 HTTP 明文测试路径，
配对令牌不等价于 TLS。
