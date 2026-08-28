import 'dart:core';

enum TaskStatus {
  queued,
  running,
  succeeded,
  failed,
  cancelled,
  timedOut,
  unknown,
}

TaskStatus taskStatusFromWire(Object? value) {
  switch (value) {
    case 'queued':
      return TaskStatus.queued;
    case 'running':
      return TaskStatus.running;
    case 'succeeded':
      return TaskStatus.succeeded;
    case 'failed':
      return TaskStatus.failed;
    case 'cancelled':
      return TaskStatus.cancelled;
    case 'timed_out':
      return TaskStatus.timedOut;
    default:
      return TaskStatus.unknown;
  }
}

String taskStatusLabel(TaskStatus status) {
  switch (status) {
    case TaskStatus.queued:
      return '排队中';
    case TaskStatus.running:
      return '运行中';
    case TaskStatus.succeeded:
      return '已完成';
    case TaskStatus.failed:
      return '失败';
    case TaskStatus.cancelled:
      return '已取消';
    case TaskStatus.timedOut:
      return '超时';
    case TaskStatus.unknown:
      return '未知';
  }
}

class BridgeEndpoint {
  const BridgeEndpoint({required this.host, required this.port, this.scheme = 'http', this.pathPrefix = ''});

  final String host;
  final int port;
  final String scheme;
  final String pathPrefix;

  Uri get baseUri => Uri(scheme: scheme, host: host, port: port, path: pathPrefix);

  Uri uriFor(String path) {
    final suffix = path.startsWith('/') ? path : '/$path';
    final prefix = pathPrefix.isEmpty || pathPrefix == '/'
        ? ''
        : '/${pathPrefix.replaceAll(RegExp(r'^/+|/+$'), '')}';
    return Uri(scheme: scheme, host: host, port: port, path: '$prefix$suffix');
  }

  String get display => '$scheme://$host:$port$pathPrefix';

  static BridgeEndpoint parse(String rawHost, String rawPort) {
    var host = rawHost.trim();
    if (host.contains('://')) {
      final parsed = Uri.tryParse(host);
      host = parsed?.host ?? '';
    }
    host = host.replaceFirst(RegExp(r'^\['), '').replaceFirst(RegExp(r'\]$'), '');
    final port = int.tryParse(rawPort.trim());
    if (host.isEmpty || host.contains('/') || host.contains(' ')) {
      throw const FormatException('请输入有效的电脑 IP 或主机名');
    }
    if (port == null || port < 1 || port > 65535) {
      throw const FormatException('端口必须是 1 到 65535 之间的整数');
    }
    return BridgeEndpoint(host: host, port: port);
  }

  static BridgeEndpoint parseRelay(String rawUrl, String rawDeviceId) {
    final url = Uri.tryParse(rawUrl.trim());
    final deviceId = rawDeviceId.trim();
    final hasPath = url != null && url.path.isNotEmpty && url.path != '/';
    if (url == null ||
        url.scheme != 'https' ||
        url.host.isEmpty ||
        hasPath ||
        url.query.isNotEmpty ||
        url.fragment.isNotEmpty ||
        url.userInfo.isNotEmpty) {
      throw const FormatException('中继地址必须是没有路径的 HTTPS URL');
    }
    if (!RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(deviceId)) {
      throw const FormatException('设备 ID 只能包含字母、数字、下划线和短横线');
    }
    return BridgeEndpoint(
      host: url.host,
      port: url.hasPort ? url.port : 443,
      scheme: 'https',
      pathPrefix: '/v1/devices/$deviceId',
    );
  }
}

class BluetoothBootstrapInfo {
  const BluetoothBootstrapInfo({
    required this.relayUrl,
    required this.deviceId,
    required this.phoneToken,
    required this.nonce,
    required this.challenge,
    required this.expiresAt,
    this.displayName,
  });

  static const protocolVersion = 1;

  factory BluetoothBootstrapInfo.fromJson(
    Map<String, dynamic> json, {
    required String expectedChallenge,
    String? expectedNonce,
  }) {
    if (json['protocol_version'] != protocolVersion) {
      throw const FormatException('蓝牙配对协议版本不受支持');
    }
    final relayUrl = json['relay_url'];
    final deviceId = json['device_id'];
    final phoneToken = json['phone_token'];
    final nonce = json['nonce'];
    final challenge = json['challenge'];
    final expiresAtWire = json['expires_at'];
    if (relayUrl is! String || deviceId is! String || phoneToken is! String || nonce is! String || challenge is! String || expiresAtWire is! String) {
      throw const FormatException('蓝牙配对响应缺少必要字段');
    }
    if (challenge != expectedChallenge || !RegExp(r'^[A-Za-z0-9_-]{16,256}$').hasMatch(challenge)) {
      throw const FormatException('蓝牙配对响应的挑战值不匹配');
    }
    if (!RegExp(r'^[A-Za-z0-9_-]{16,256}$').hasMatch(nonce)) {
      throw const FormatException('蓝牙配对响应的会话随机数无效');
    }
    if (expectedNonce != null && nonce != expectedNonce) {
      throw const FormatException('蓝牙配对响应不属于当前配对会话');
    }
    if (!RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(deviceId)) {
      throw const FormatException('蓝牙配对响应的设备 ID 无效');
    }
    if (!RegExp(r'^[^\s]{16,512}$').hasMatch(phoneToken)) {
      throw const FormatException('蓝牙配对响应的手机令牌无效');
    }
    final expiresAt = DateTime.tryParse(expiresAtWire)?.toUtc();
    if (expiresAt == null || !expiresAt.isAfter(DateTime.now().toUtc())) {
      throw const FormatException('蓝牙配对响应已经过期');
    }
    final url = Uri.tryParse(relayUrl);
    final hasPath = url != null && url.path.isNotEmpty && url.path != '/';
    if (url == null || url.scheme != 'https' || url.host.isEmpty || url.userInfo.isNotEmpty || url.query.isNotEmpty || url.fragment.isNotEmpty || hasPath) {
      throw const FormatException('蓝牙配对响应的中继地址必须是没有路径的 HTTPS URL');
    }
    return BluetoothBootstrapInfo(
      relayUrl: relayUrl,
      deviceId: deviceId,
      phoneToken: phoneToken,
      nonce: nonce,
      challenge: challenge,
      expiresAt: expiresAt,
      displayName: json['display_name'] is String ? json['display_name'] as String : null,
    );
  }

  final String relayUrl;
  final String deviceId;
  final String phoneToken;
  final String nonce;
  final String challenge;
  final DateTime expiresAt;
  final String? displayName;
}

class PairingSession {
  const PairingSession({required this.endpoint, required this.sessionToken});

  final BridgeEndpoint endpoint;
  final String sessionToken;
}

class RemoteTask {
  const RemoteTask({
    required this.id,
    required this.status,
    required this.summary,
    required this.nextActions,
    required this.artifacts,
    required this.output,
    required this.outputTruncated,
    required this.createdAt,
    required this.updatedAt,
    this.exitCode,
  });

  factory RemoteTask.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    if (id is! String || id.isEmpty) throw const FormatException('任务响应缺少 id');
    final actions = (json['next_actions'] as List<dynamic>? ?? const <dynamic>[])
        .whereType<String>()
        .toList(growable: false);
    final artifacts = (json['artifacts'] as List<dynamic>? ?? const <dynamic>[])
        .whereType<String>()
        .toList(growable: false);
    return RemoteTask(
      id: id,
      status: taskStatusFromWire(json['status']),
      summary: json['summary'] is String ? json['summary'] as String : '桥接器未提供摘要',
      nextActions: actions,
      artifacts: artifacts,
      output: json['output'] is String ? json['output'] as String : '',
      outputTruncated: json['output_truncated'] == true,
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
      updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? '') ?? DateTime.now(),
      exitCode: json['exit_code'] is int ? json['exit_code'] as int : null,
    );
  }

  final String id;
  final TaskStatus status;
  final String summary;
  final List<String> nextActions;
  final List<String> artifacts;
  final String output;
  final bool outputTruncated;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int? exitCode;

  bool get isActive => status == TaskStatus.queued || status == TaskStatus.running;

  RemoteTask copyWith({
    TaskStatus? status,
    String? summary,
    List<String>? nextActions,
    List<String>? artifacts,
    String? output,
    bool? outputTruncated,
    DateTime? updatedAt,
    int? exitCode,
  }) {
    return RemoteTask(
      id: id,
      status: status ?? this.status,
      summary: summary ?? this.summary,
      nextActions: nextActions ?? this.nextActions,
      artifacts: artifacts ?? this.artifacts,
      output: output ?? this.output,
      outputTruncated: outputTruncated ?? this.outputTruncated,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      exitCode: exitCode ?? this.exitCode,
    );
  }
}

class BridgeSnapshot {
  const BridgeSnapshot({
    required this.paired,
    required this.activeJobs,
    required this.maxJobs,
    required this.taskLimitChars,
    required this.outputLimitChars,
    required this.tasks,
  });

  factory BridgeSnapshot.fromJson(Map<String, dynamic> json) {
    final bridge = json['bridge'];
    final bridgeMap = bridge is Map<String, dynamic> ? bridge : const <String, dynamic>{};
    final taskList = json['tasks'];
    final tasks = taskList is List<dynamic>
        ? taskList.whereType<Map<String, dynamic>>().map(RemoteTask.fromJson).toList(growable: false)
        : const <RemoteTask>[];
    return BridgeSnapshot(
      paired: bridgeMap['paired'] == true,
      activeJobs: bridgeMap['active_jobs'] is int ? bridgeMap['active_jobs'] as int : 0,
      maxJobs: bridgeMap['max_jobs'] is int ? bridgeMap['max_jobs'] as int : 0,
      taskLimitChars: bridgeMap['task_limit_chars'] is int ? bridgeMap['task_limit_chars'] as int : 0,
      outputLimitChars: bridgeMap['output_limit_chars'] is int ? bridgeMap['output_limit_chars'] as int : 0,
      tasks: tasks,
    );
  }

  final bool paired;
  final int activeJobs;
  final int maxJobs;
  final int taskLimitChars;
  final int outputLimitChars;
  final List<RemoteTask> tasks;
}

class BridgeApiException implements Exception {
  const BridgeApiException({required this.statusCode, required this.code, required this.message});

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => message;
}
