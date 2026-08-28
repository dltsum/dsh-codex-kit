import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../../domain/models.dart';

abstract interface class BridgeApi {
  Future<PairingSession> pair(BridgeEndpoint endpoint, String pairingToken);

  Future<BridgeSnapshot> fetchStatus(PairingSession session);

  Future<RemoteTask> submitTask(PairingSession session, String task, {required bool codeMode});

  Future<RemoteTask> fetchTask(PairingSession session, String taskId);

  Future<RemoteTask> cancelTask(PairingSession session, String taskId);
}

class BridgeApiService implements BridgeApi {
  BridgeApiService({HttpClient? client, Duration timeout = const Duration(seconds: 15)})
      : _client = client ?? HttpClient(),
        _ownsClient = client == null,
        _timeout = timeout;

  final HttpClient _client;
  final bool _ownsClient;
  final Duration _timeout;

  Future<void> close() async {
    if (_ownsClient) _client.close(force: true);
  }

  @override
  Future<PairingSession> pair(BridgeEndpoint endpoint, String pairingToken) async {
    final token = pairingToken.trim();
    if (token.length < 16) {
      throw const BridgeApiException(statusCode: 0, code: 'InvalidPairingToken', message: '配对令牌至少需要 16 个字符');
    }
    final json = await _request('POST', endpoint, '/v1/pair', body: {'token': token});
    final sessionToken = json['session_token'];
    if (sessionToken is! String || sessionToken.isEmpty) {
      throw const BridgeApiException(statusCode: 0, code: 'InvalidPairResponse', message: '桥接器返回的 session token 无效');
    }
    return PairingSession(endpoint: endpoint, sessionToken: sessionToken);
  }

  @override
  Future<BridgeSnapshot> fetchStatus(PairingSession session) async {
    return BridgeSnapshot.fromJson(await _request('GET', session.endpoint, '/v1/status', session: session));
  }

  @override
  Future<RemoteTask> submitTask(PairingSession session, String task, {required bool codeMode}) async {
    final json = await _request('POST', session.endpoint, '/v1/tasks', session: session, body: {
      'task': task,
      'code': codeMode,
    });
    return RemoteTask.fromJson(json);
  }

  @override
  Future<RemoteTask> fetchTask(PairingSession session, String taskId) async {
    return RemoteTask.fromJson(await _request('GET', session.endpoint, '/v1/tasks/$taskId', session: session));
  }

  @override
  Future<RemoteTask> cancelTask(PairingSession session, String taskId) async {
    return RemoteTask.fromJson(await _request('POST', session.endpoint, '/v1/tasks/$taskId/cancel', session: session));
  }

  Future<Map<String, dynamic>> _request(
    String method,
    BridgeEndpoint endpoint,
    String path, {
    PairingSession? session,
    Map<String, Object?>? body,
  }) async {
    try {
      final request = await _client.openUrl(method, endpoint.uriFor(path)).timeout(_timeout);
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      if (session != null) request.headers.set(HttpHeaders.authorizationHeader, 'Bearer ${session.sessionToken}');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(_timeout);
      final text = await response.transform(utf8.decoder).join().timeout(_timeout);
      Map<String, dynamic> decoded;
      try {
        final value = jsonDecode(text);
        decoded = value is Map<String, dynamic> ? value : <String, dynamic>{};
      } catch (_) {
        throw const BridgeApiException(statusCode: 0, code: 'InvalidJson', message: '桥接器返回了无法解析的 JSON');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = decoded['summary'] is String ? decoded['summary'] as String : '桥接器请求失败';
        final code = decoded['error_code'] is String ? decoded['error_code'] as String : 'HttpError';
        throw BridgeApiException(statusCode: response.statusCode, code: code, message: message);
      }
      return decoded;
    } on BridgeApiException {
      rethrow;
    } on TimeoutException {
      throw const BridgeApiException(statusCode: 0, code: 'Timeout', message: '连接桥接器超时，请检查电脑地址和网络');
    } on SocketException {
      throw const BridgeApiException(statusCode: 0, code: 'NetworkError', message: '无法连接桥接器，请检查它是否已启动及防火墙设置');
    } on FormatException {
      throw const BridgeApiException(statusCode: 0, code: 'InvalidResponse', message: '桥接器返回格式不正确');
    } catch (_) {
      throw const BridgeApiException(statusCode: 0, code: 'NetworkError', message: '与桥接器通信失败');
    }
  }
}
