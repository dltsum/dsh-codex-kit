# Android 远程控制端实施记录

更新时间：2026-08-28

## 目标与边界

把手机变成自己电脑上 DSH 的本地控制面板：配对、查看有限状态、提交固定
`skillopt-headless` 任务、轮询有界输出、取消任务。桥接器不提供任意 Shell、文件上传、插件安装、
浏览器控制或凭据读取；默认只监听回环地址。

## 已完成

- [x] 冻结 HTTP v1 协议和统一 `{status, summary, next_actions, artifacts}` 响应结构。
- [x] `remote/bridge.mjs`：一次性内存配对、Bearer session、局域网显式开关、并发/任务/输出/运行时限额、
  有界历史、取消和 Windows 非 shell 子进程启动。
- [x] `test/remote-bridge.test.mjs`：健康检查、未配对拒绝、错误令牌、一次性配对、任务轮询、超长任务、
  非法控制接口和取消路径。
- [x] `mobile/lib`：不可变 domain 模型、HTTP service、repository、ChangeNotifier ViewModel 和 Material 3 UI。
- [x] `mobile/test`：端点校验、wire 状态解析、坏响应显式失败、ViewModel 连接/提交/选择/取消。
- [x] `mobile/bootstrap.ps1` / `mobile/bootstrap.sh`：有 Flutter 时生成 Android 平台工程、覆盖网络 Manifest、
  运行 `flutter analyze` 和 `flutter test`。
- [x] 根 README、中文手册、SECURITY 和 npm 打包清单已链接手机端；新增代码不含凭据形态文本。

## 验证证据

- `npm test`：30/30 通过。
- `npm run check:syntax`：24 个 JavaScript 文件通过。
- `npm run check:public`：56 个文本文件通过，无已知凭据模式或超大文件。
- `npm run pack:dry`：包含 `mobile/`、`remote/` 源码和文档，不包含依赖、构建产物或令牌。
- `node remote/bridge.mjs --host 0.0.0.0 --port 8787`：拒绝无 `--allow-lan` 的非回环监听。
- 当前开发机没有 `flutter`、`dart`、Gradle 或 `adb` 命令；因此 Flutter 分析、设备测试和 APK 构建仍需在
  安装 Android 工具链的机器执行，不能标记为已完成。

## 待在 Android 工具链机器执行

```powershell
Set-Location .\mobile
.\bootstrap.ps1
flutter build apk --release
```

构建后先在可信 LAN 做低风险只读任务的配对、轮询和取消验收，再考虑文件修改类任务。跨不可信网络
必须先使用 Tailscale/SSH 隧道；当前桥接器 HTTP 明文和配对令牌不等价于 TLS。
