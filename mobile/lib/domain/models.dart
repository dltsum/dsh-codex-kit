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
  const BridgeEndpoint({required this.host, required this.port});

  final String host;
  final int port;

  Uri get baseUri => Uri(scheme: 'http', host: host, port: port);

  String get display => '$host:$port';

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
