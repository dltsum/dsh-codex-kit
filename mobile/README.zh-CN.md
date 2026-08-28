# DSH Android 手机控制端

这是配套 `remote/bridge.mjs` 的最小可用 Android 客户端源码。它只做四件事：连接并配对、查看
状态、提交固定的 `skillopt-headless` 任务、轮询输出和取消任务。session token 只保存在进程内存；
没有账号体系、云端服务、后台常驻服务、任意 Shell、文件上传或凭据存储。

桥接器的工作目录就是它启动时的电脑当前目录。要控制某个仓库，请先在该仓库根目录启动桥接器；
App 没有远程切换目录的功能。

## 当前交付边界

- 已完成：Flutter 分层源码（domain/data/repository/MVVM UI）、HTTP 协议客户端、配对表单、任务列表、
  输出查看、Code Mode 开关、取消按钮、模型与 ViewModel 单元测试。
- 已完成：Android Manifest overlay，声明网络权限，并允许连接本地 HTTP 桥接器。
- 需在有工具的机器完成：Flutter 工程生成、`flutter analyze`、`flutter test` 和 APK 编译。
  当前开发环境没有 `flutter`、Gradle 或 Android SDK，因此不能诚实地声称已经生成 APK。

## 一键生成 Android 工程

先安装 Flutter stable、Android SDK、Android SDK Platform/Build Tools，并接受许可证：

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
再覆盖 Manifest overlay、拉取 SDK 依赖并运行分析和测试。它不会接触 DSH_HOME、API key、PAT 或
任何已有凭据。生成的 APK 位于 `build/app/outputs/flutter-apk/app-release.apk`。

## 连接流程

1. 在电脑端运行桥接器（推荐先在同一台电脑上自测）：

   ```powershell
   node ..\remote\bridge.mjs
   ```

2. 手机与电脑在同一可信 LAN 时，才使用：

   ```powershell
   node ..\remote\bridge.mjs --host 0.0.0.0 --port 8787 --allow-lan
   ```

3. 用 `ipconfig` 找到电脑的 LAN IPv4 地址，在 App 填入 IP、`8787` 和终端显示的配对令牌，点击“连接”。
4. 连接后提交自然语言任务；App 每秒轮询状态，输出过长时会显示“仅显示尾部”。
5. 只在确实需要代码工具时打开 Code Mode；取消按钮只取消当前 DSH 子进程，不会删除 spill、metrics 或工作文件。

## 易错点与限制

- `127.0.0.1` 对手机来说是手机自己，不是电脑。手机连接必须填电脑 LAN IP；电脑端必须显式 `--allow-lan`。
- Android Manifest 当前开启 `usesCleartextTraffic=true`，因为桥接器 MVP 使用 LAN HTTP。只在可信 LAN/VPN 使用，
  不要做公网端口转发。需要跨不可信网络时，先用 Tailscale 或 SSH 隧道；不要把配对令牌当作 TLS。
- Windows 防火墙可能拦截 8787；只允许 Private/家庭网络的入站规则，完成后关闭，不要开放 Public profile。
- 桥接器重启后配对 session 失效；App 重启后也需要重新配对。令牌和 session 不写入本地存储。
- 输出和任务历史只在桥接器内存保留，最多 32 条；桥接器退出后不提供历史恢复。
- 这是控制自己电脑上 DSH 的操作界面，不是远程桌面或公网多用户服务；不要把它交给不受信任的人。

## 手工验证

```powershell
flutter analyze
flutter test
flutter build apk --debug
```

同时在电脑端运行 `node ..\remote\bridge.mjs`，再用手机或 `remote/README.zh-CN.md` 的 PowerShell
示例完成一次真实配对和一个低风险只读任务。先确认桥接器日志、任务状态和输出均符合预期，再执行会
修改文件的任务。
