import 'package:flutter_test/flutter_test.dart';

import 'package:dsh_remote_control/domain/models.dart';

void main() {
  test('parses an endpoint without allowing a path or invalid port', () {
    expect(BridgeEndpoint.parse('http://192.168.1.20', '8787').display, '192.168.1.20:8787');
    expect(() => BridgeEndpoint.parse('192.168.1.20/path', '8787'), throwsFormatException);
    expect(() => BridgeEndpoint.parse('192.168.1.20', '0'), throwsFormatException);
  });

  test('maps wire task statuses and preserves bounded output metadata', () {
    final task = RemoteTask.fromJson({
      'id': 'task-1',
      'status': 'running',
      'summary': 'DSH is running',
      'next_actions': ['poll'],
      'artifacts': [],
      'output': 'partial',
      'output_truncated': true,
      'created_at': '2026-08-28T00:00:00Z',
      'updated_at': '2026-08-28T00:00:01Z',
    });
    expect(task.status, TaskStatus.running);
    expect(task.isActive, isTrue);
    expect(task.outputTruncated, isTrue);
    expect(taskStatusLabel(TaskStatus.timedOut), '超时');
  });

  test('malformed task responses fail visibly', () {
    expect(() => RemoteTask.fromJson({'status': 'succeeded'}), throwsFormatException);
  });
}
