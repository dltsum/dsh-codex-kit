import 'package:flutter_test/flutter_test.dart';

import 'package:dsh_remote_control/data/repositories/remote_control_repository.dart';
import 'package:dsh_remote_control/data/services/bridge_api_service.dart';
import 'package:dsh_remote_control/domain/models.dart';
import 'package:dsh_remote_control/ui/features/control/view_models/control_view_model.dart';

class FakeBridgeApi implements BridgeApi {
  final BridgeEndpoint endpoint = const BridgeEndpoint(host: '127.0.0.1', port: 8787);
  final List<RemoteTask> storedTasks = <RemoteTask>[];
  int fetchCount = 0;

  @override
  Future<PairingSession> pair(BridgeEndpoint requested, String pairingToken) async {
    expect(requested.host, endpoint.host);
    expect(requested.port, endpoint.port);
    expect(pairingToken, 'pairing-token-for-test');
    return PairingSession(endpoint: requested, sessionToken: 'session-token');
  }

  @override
  Future<BridgeSnapshot> fetchStatus(PairingSession session) async {
    fetchCount += 1;
    return BridgeSnapshot(
      paired: true,
      activeJobs: storedTasks.where((task) => task.isActive).length,
      maxJobs: 4,
      taskLimitChars: 16000,
      outputLimitChars: 262144,
      tasks: List.unmodifiable(storedTasks),
    );
  }

  @override
  Future<RemoteTask> submitTask(PairingSession session, String task, {required bool codeMode}) async {
    final created = _task(id: 'task-1', status: TaskStatus.running, output: 'running');
    storedTasks.insert(0, created);
    return created;
  }

  @override
  Future<RemoteTask> fetchTask(PairingSession session, String taskId) async => storedTasks.first;

  @override
  Future<RemoteTask> cancelTask(PairingSession session, String taskId) async {
    final cancelled = _task(id: taskId, status: TaskStatus.cancelled, output: 'cancelled');
    storedTasks
      ..clear()
      ..add(cancelled);
    return cancelled;
  }

  RemoteTask _task({required String id, required TaskStatus status, required String output}) {
    return RemoteTask(
      id: id,
      status: status,
      summary: 'fake task',
      nextActions: const <String>[],
      artifacts: const <String>[],
      output: output,
      outputTruncated: false,
      createdAt: DateTime.utc(2026, 8, 28),
      updatedAt: DateTime.utc(2026, 8, 28),
    );
  }
}

void main() {
  test('view model connects, submits, selects, and cancels without persisting tokens', () async {
    final api = FakeBridgeApi();
    final viewModel = ControlViewModel(repository: RemoteControlRepository(api: api));
    addTearDown(viewModel.dispose);

    await viewModel.connect(host: '127.0.0.1', port: '8787', pairingToken: 'pairing-token-for-test');
    expect(viewModel.state, ControlState.ready);
    expect(viewModel.isPaired, isTrue);
    expect(api.fetchCount, 1);

    await viewModel.submit('  inspect tests  ', codeMode: false);
    expect(viewModel.tasks, hasLength(1));
    expect(viewModel.selectedTask?.id, 'task-1');
    expect(viewModel.selectedTask?.status, TaskStatus.running);

    await viewModel.cancel(viewModel.selectedTask!);
    expect(viewModel.selectedTask?.status, TaskStatus.cancelled);
  });
}
