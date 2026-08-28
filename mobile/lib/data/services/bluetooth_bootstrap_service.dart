import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../domain/models.dart';

const bluetoothBootstrapProtocolVersion = 1;
const bluetoothBootstrapServiceUuid = 'd5c0d5c0-0001-4d53-9f0d-445348000001';
const bluetoothBootstrapInfoCharacteristicUuid = 'd5c0d5c0-0001-4d53-9f0d-445348000002';
const bluetoothBootstrapRequestCharacteristicUuid = 'd5c0d5c0-0001-4d53-9f0d-445348000003';
const bluetoothBootstrapResponseCharacteristicUuid = 'd5c0d5c0-0001-4d53-9f0d-445348000004';

class BluetoothBootstrapException implements Exception {
  const BluetoothBootstrapException({required this.code, required this.message});

  final String code;
  final String message;

  @override
  String toString() => message;
}

class BluetoothBootstrapService {
  BluetoothBootstrapService({Random? random, License license = License.nonprofit})
      : _random = random ?? Random.secure(),
        _license = license;

  final Random _random;
  final License _license;

  Future<BluetoothBootstrapInfo> discoverAndPair({
    Duration scanTimeout = const Duration(seconds: 20),
    Duration responseTimeout = const Duration(seconds: 8),
    Future<bool> Function(BluetoothBootstrapInfo info)? confirm,
  }) async {
    if (!Platform.isAndroid) {
      throw const BluetoothBootstrapException(code: 'AndroidOnly', message: '蓝牙自动配对目前只支持 Android 手机');
    }
    if (scanTimeout < const Duration(seconds: 5) || scanTimeout > const Duration(minutes: 2)) {
      throw const BluetoothBootstrapException(code: 'InvalidScanTimeout', message: '蓝牙扫描时长必须在 5 秒到 2 分钟之间');
    }
    await _requestPermissions();
    await _ensureAdapter();
    final device = await _scan(scanTimeout);
    try {
      await device.connect(license: _license, timeout: const Duration(seconds: 15), autoConnect: false);
      final services = await device.discoverServices(timeout: 15);
      final service = _findService(services, Guid(bluetoothBootstrapServiceUuid));
      final infoCharacteristic = _findCharacteristic(service, Guid(bluetoothBootstrapInfoCharacteristicUuid));
      final requestCharacteristic = _findCharacteristic(service, Guid(bluetoothBootstrapRequestCharacteristicUuid));
      final responseCharacteristic = _findCharacteristic(service, Guid(bluetoothBootstrapResponseCharacteristicUuid));
      final info = await _readJson(infoCharacteristic, '蓝牙设备信息');
      final nonce = info['nonce'];
      if (info['protocol_version'] != bluetoothBootstrapProtocolVersion || nonce is! String || !RegExp(r'^[A-Za-z0-9_-]{16,256}$').hasMatch(nonce)) {
        throw const BluetoothBootstrapException(code: 'InvalidBootstrapInfo', message: '蓝牙设备返回的信息无效或协议版本不兼容');
      }
      final challenge = _challenge();
      final response = await _requestBootstrap(
        requestCharacteristic: requestCharacteristic,
        responseCharacteristic: responseCharacteristic,
        nonce: nonce,
        challenge: challenge,
        timeout: responseTimeout,
      );
      final pairing = BluetoothBootstrapInfo.fromJson(response, expectedChallenge: challenge, expectedNonce: nonce);
      if (confirm != null && !await confirm(pairing)) {
        throw const BluetoothBootstrapException(code: 'PairingCancelled', message: '已取消这次蓝牙配对');
      }
      return pairing;
    } on BluetoothBootstrapException {
      rethrow;
    } catch (_) {
      throw const BluetoothBootstrapException(code: 'BluetoothExchangeFailed', message: '蓝牙配对失败，请确认电脑 Agent 正在广播且接受了系统配对提示');
    } finally {
      await _disconnectSafely(device);
    }
  }

  Future<void> _requestPermissions() async {
    final requested = <Permission>[
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
    ];
    final apiLevel = _androidApiLevel();
    if (apiLevel != null && apiLevel <= 30) requested.add(Permission.locationWhenInUse);
    final statuses = await requested.request();
    final denied = statuses.entries.where((entry) => !entry.value.isGranted).toList(growable: false);
    if (denied.isEmpty) return;
    final permanentlyDenied = denied.any((entry) => entry.value.isPermanentlyDenied);
    throw BluetoothBootstrapException(
      code: permanentlyDenied ? 'BluetoothPermissionPermanentlyDenied' : 'BluetoothPermissionDenied',
      message: permanentlyDenied ? '蓝牙权限已被永久拒绝，请到系统设置中允许“附近的设备”权限' : '需要允许“附近的设备”权限才能扫描电脑',
    );
  }

  Future<void> _ensureAdapter() async {
    if (!await FlutterBluePlus.isSupported) {
      throw const BluetoothBootstrapException(code: 'BluetoothUnsupported', message: '这台手机不支持 Bluetooth Low Energy');
    }
    BluetoothAdapterState state;
    try {
      state = await FlutterBluePlus.adapterState.first.timeout(const Duration(seconds: 8));
    } catch (_) {
      throw const BluetoothBootstrapException(code: 'BluetoothUnavailable', message: '无法读取手机蓝牙状态，请重试或检查系统设置');
    }
    if (state == BluetoothAdapterState.on) return;
    try {
      await FlutterBluePlus.turnOn(timeout: 20);
      state = await FlutterBluePlus.adapterState.first.timeout(const Duration(seconds: 8));
    } catch (_) {
      throw const BluetoothBootstrapException(code: 'BluetoothOff', message: '请打开手机蓝牙后再扫描电脑');
    }
    if (state != BluetoothAdapterState.on) {
      throw const BluetoothBootstrapException(code: 'BluetoothOff', message: '请打开手机蓝牙后再扫描电脑');
    }
  }

  Future<BluetoothDevice> _scan(Duration timeout) async {
    final serviceUuid = Guid(bluetoothBootstrapServiceUuid);
    final found = Completer<ScanResult>();
    StreamSubscription<List<ScanResult>>? subscription;
    subscription = FlutterBluePlus.onScanResults.listen(
      (results) {
        for (final result in results) {
          if (result.advertisementData.serviceUuids.contains(serviceUuid) && !found.isCompleted) {
            found.complete(result);
            return;
          }
        }
      },
      onError: (Object error, StackTrace stack) {
        if (!found.isCompleted) {
          found.completeError(const BluetoothBootstrapException(code: 'BluetoothScanFailed', message: '蓝牙扫描失败，请检查系统权限和适配器状态'), stack);
        }
      },
    );
    try {
      await FlutterBluePlus.startScan(withServices: [serviceUuid], timeout: timeout);
      final result = await found.future.timeout(timeout + const Duration(seconds: 2), onTimeout: () {
        throw const BluetoothBootstrapException(code: 'ComputerNotFound', message: '没有发现 DSH 电脑 Agent，请先在电脑运行 Agent --bluetooth');
      });
      return result.device;
    } on BluetoothBootstrapException {
      rethrow;
    } on TimeoutException {
      throw const BluetoothBootstrapException(code: 'ComputerNotFound', message: '没有发现 DSH 电脑 Agent，请先在电脑运行 Agent --bluetooth');
    } catch (_) {
      throw const BluetoothBootstrapException(code: 'BluetoothScanFailed', message: '蓝牙扫描失败，请检查系统权限和适配器状态');
    } finally {
      if (FlutterBluePlus.isScanningNow) await FlutterBluePlus.stopScan();
      if (subscription != null) await subscription.cancel();
    }
  }

  Future<Map<String, dynamic>> _readJson(BluetoothCharacteristic characteristic, String label) async {
    try {
      final bytes = await characteristic.read(timeout: 10);
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map) throw const FormatException();
      return Map<String, dynamic>.from(decoded);
    } catch (_) {
      throw BluetoothBootstrapException(code: 'InvalidBluetoothPayload', message: '$label格式不正确');
    }
  }

  Future<Map<String, dynamic>> _requestBootstrap({
    required BluetoothCharacteristic requestCharacteristic,
    required BluetoothCharacteristic responseCharacteristic,
    required String nonce,
    required String challenge,
    required Duration timeout,
  }) async {
    final responseBytes = Completer<List<int>>();
    final subscription = responseCharacteristic.onValueReceived.listen(
      (value) {
        if (!responseBytes.isCompleted) responseBytes.complete(List<int>.from(value));
      },
      onError: (Object error, StackTrace stack) {
        if (!responseBytes.isCompleted) {
          responseBytes.completeError(const BluetoothBootstrapException(code: 'BluetoothResponseFailed', message: '电脑没有返回有效的蓝牙配对响应'), stack);
        }
      },
    );
    try {
      await responseCharacteristic.setNotifyValue(true);
      await requestCharacteristic.write(
        utf8.encode(jsonEncode({
          'protocol_version': bluetoothBootstrapProtocolVersion,
          'nonce': nonce,
          'challenge': challenge,
        })),
        withoutResponse: false,
      );
      List<int> bytes;
      try {
        bytes = await responseBytes.future.timeout(timeout);
      } on TimeoutException {
        // Some Windows BLE stacks accept the write but do not deliver notify
        // packets. A secure read of the same one-use response is the fallback.
        bytes = await responseCharacteristic.read(timeout: 10);
      }
      if (bytes.isEmpty || bytes.length > 512) throw const FormatException();
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map) throw const FormatException();
      return Map<String, dynamic>.from(decoded);
    } on BluetoothBootstrapException {
      rethrow;
    } on FormatException {
      throw const BluetoothBootstrapException(code: 'InvalidBluetoothPayload', message: '电脑返回的蓝牙配对信息格式不正确');
    } catch (_) {
      throw const BluetoothBootstrapException(code: 'BluetoothExchangeFailed', message: '蓝牙配对交换失败，请确认电脑 Agent 仍在配对窗口内');
    } finally {
      try {
        await responseCharacteristic.setNotifyValue(false);
      } catch (_) {
        // The device is disconnected in the caller's finally block.
      }
      await subscription.cancel();
    }
  }

  String _challenge() {
    final bytes = List<int>.generate(24, (_) => _random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  BluetoothService _findService(List<BluetoothService> services, Guid uuid) {
    for (final service in services) {
      if (service.serviceUuid == uuid) return service;
    }
    throw const BluetoothBootstrapException(code: 'BootstrapServiceMissing', message: '连接的设备不是 DSH 电脑 Agent');
  }

  BluetoothCharacteristic _findCharacteristic(BluetoothService service, Guid uuid) {
    for (final characteristic in service.characteristics) {
      if (characteristic.characteristicUuid == uuid) return characteristic;
    }
    throw const BluetoothBootstrapException(code: 'BootstrapCharacteristicMissing', message: 'DSH 电脑 Agent 缺少配对特征');
  }

  Future<void> _disconnectSafely(BluetoothDevice device) async {
    try {
      if (device.isConnected) await device.disconnect();
    } catch (_) {
      // The pairing data has already been copied or an explicit error was
      // returned; disconnect failures must not mask that result.
    }
  }

  int? _androidApiLevel() {
    final match = RegExp(r'API\s+(\d+)').firstMatch(Platform.operatingSystemVersion);
    return int.tryParse(match?.group(1) ?? '');
  }
}
