import 'dart:async';

import '../../../../data/repositories/remote_control_repository.dart';
import '../../../../domain/models.dart';
import 'package:flutter/foundation.dart';

enum ControlState {
  disconnected,
  pairing,
  ready,
  submitting,
  refreshing,
  error,
}

class ControlViewModel extends ChangeNotifier {
  ControlViewModel({required RemoteControlRepository repository}) : _repository = repository;

  final RemoteControlRepository _repository;
  Timer? _pollTimer;
  bool _refreshInFlight = false;
  ControlState _state = ControlState.disconnected;
  String? _errorMessage;
  BridgeSnapshot? _snapshot;
  List<RemoteTask> _tasks = const <RemoteTask>[];
  RemoteTask? _selectedTask;

  ControlState get state => _state;
  String? get errorMessage => _errorMessage;
  BridgeSnapshot? get snapshot => _snapshot;
  List<RemoteTask> get tasks => List.unmodifiable(_tasks);
  RemoteTask? get selectedTask => _selectedTask;
  bool get isPaired => _repository.isPaired;
  bool get busy => _state == ControlState.pairing || _state == ControlState.submitting || _state == ControlState.refreshing;

  Future<void> connect({required String host, required String port, required String pairingToken}) async {
    _setState(ControlState.pairing);
    try {
      final endpoint = BridgeEndpoint.parse(host, port);
      await _repository.pair(endpoint, pairingToken);
      await refresh();
      _startPolling();
    } on Object catch (error) {
      _setError(_messageFor(error));
    }
  }

  Future<void> refresh() async {
    if (!isPaired || _refreshInFlight) return;
    _refreshInFlight = true;
    if (_state != ControlState.submitting) _setState(ControlState.refreshing);
    try {
      final snapshot = await _repository.fetchStatus();
      _snapshot = snapshot;
      final visibleTasks = <RemoteTask>[];
      for (final task in snapshot.tasks) {
        final needsOutput = task.isActive || task.id == _selectedTask?.id;
        visibleTasks.add(needsOutput ? await _repository.fetchTask(task.id) : task);
      }
      _tasks = List.unmodifiable(visibleTasks);
      if (_selectedTask != null) {
        final matching = _tasks.where((task) => task.id == _selectedTask!.id);
        _selectedTask = matching.isEmpty ? _selectedTask : matching.first;
      }
      _errorMessage = null;
      if (_state != ControlState.submitting) _setState(ControlState.ready);
    } on Object catch (error) {
      _setError(_messageFor(error));
    } finally {
      _refreshInFlight = false;
    }
  }

  Future<void> submit(String task, {required bool codeMode}) async {
    if (!isPaired) {
      _setError('请先连接电脑端桥接器');
      return;
    }
    _setState(ControlState.submitting);
    try {
      final created = await _repository.submitTask(task, codeMode: codeMode);
      _upsert(created);
      _selectedTask = created;
      _errorMessage = null;
      _setState(ControlState.ready);
      _startPolling();
    } on Object catch (error) {
      _setError(_messageFor(error));
    }
  }

  Future<void> cancel(RemoteTask task) async {
    if (!isPaired || !task.isActive) return;
    try {
      final cancelled = await _repository.cancelTask(task.id);
      _upsert(cancelled);
      _selectedTask = cancelled;
      _errorMessage = null;
      notifyListeners();
    } on Object catch (error) {
      _setError(_messageFor(error));
    }
  }

  void select(RemoteTask task) {
    _selectedTask = task;
    notifyListeners();
  }

  void disconnect() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _repository.disconnect();
    _snapshot = null;
    _tasks = const <RemoteTask>[];
    _selectedTask = null;
    _errorMessage = null;
    _setState(ControlState.disconnected);
  }

  void _startPolling() {
    _pollTimer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (_tasks.any((task) => task.isActive)) unawaited(refresh());
    });
  }

  void _upsert(RemoteTask task) {
    final next = <RemoteTask>[task, ..._tasks.where((item) => item.id != task.id)];
    _tasks = next;
  }

  void _setState(ControlState value) {
    _state = value;
    notifyListeners();
  }

  void _setError(String message) {
    _errorMessage = message;
    _state = ControlState.error;
    notifyListeners();
  }

  String _messageFor(Object error) {
    if (error is BridgeApiException) return error.message;
    if (error is FormatException) return error.message;
    return '操作失败，请检查桥接器和网络设置';
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _repository.disconnect();
    super.dispose();
  }
}
