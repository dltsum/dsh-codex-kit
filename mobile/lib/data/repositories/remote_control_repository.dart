import '../services/bridge_api_service.dart';
import '../../domain/models.dart';

class RemoteControlRepository {
  RemoteControlRepository({required BridgeApi api}) : _api = api;

  final BridgeApi _api;
  PairingSession? _session;

  bool get isPaired => _session != null;

  Future<void> pair(BridgeEndpoint endpoint, String pairingToken) async {
    final session = await _api.pair(endpoint, pairingToken);
    _session = session;
  }

  Future<BridgeSnapshot> fetchStatus() async {
    return _api.fetchStatus(_requireSession());
  }

  Future<RemoteTask> submitTask(String task, {required bool codeMode}) async {
    final trimmed = task.trim();
    if (trimmed.isEmpty) {
      throw const BridgeApiException(statusCode: 0, code: 'TaskRequired', message: '任务不能为空');
    }
    return _api.submitTask(_requireSession(), trimmed, codeMode: codeMode);
  }

  Future<RemoteTask> fetchTask(String taskId) async {
    return _api.fetchTask(_requireSession(), taskId);
  }

  Future<RemoteTask> cancelTask(String taskId) async {
    return _api.cancelTask(_requireSession(), taskId);
  }

  void disconnect() {
    _session = null;
  }

  PairingSession _requireSession() {
    final session = _session;
    if (session == null) {
      throw const BridgeApiException(statusCode: 0, code: 'NotPaired', message: '请先连接电脑端桥接器');
    }
    return session;
  }
}
