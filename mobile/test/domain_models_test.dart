import 'package:flutter_test/flutter_test.dart';

import 'package:dsh_remote_control/domain/models.dart';

void main() {
  test('parses an endpoint without allowing a path or invalid port', () {
    expect(BridgeEndpoint.parse('http://192.168.1.20', '8787').display, 'http://192.168.1.20:8787');
    expect(() => BridgeEndpoint.parse('192.168.1.20/path', '8787'), throwsFormatException);
    expect(() => BridgeEndpoint.parse('192.168.1.20', '0'), throwsFormatException);
  });

  test('builds an HTTPS relay namespace without accepting a URL path', () {
    final endpoint = BridgeEndpoint.parseRelay('https://relay.example.test/', 'office-pc');
    expect(endpoint.uriFor('/v1/status').toString(), 'https://relay.example.test:443/v1/devices/office-pc/v1/status');
    expect(() => BridgeEndpoint.parseRelay('http://relay.example.test', 'office-pc'), throwsFormatException);
    expect(() => BridgeEndpoint.parseRelay('https://relay.example.test/base', 'office-pc'), throwsFormatException);
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

  test('valid Bluetooth bootstrap responses validate the challenge and expiry', () {
    final info = BluetoothBootstrapInfo.fromJson({
      'protocol_version': 1,
      'relay_url': 'https://relay.example.test/',
      'device_id': 'office-pc',
      'phone_token': 'phone-token-for-model-test',
      'nonce': 'nonce-for-model-test',
      'challenge': 'challenge-for-model-test',
      'expires_at': DateTime.now().toUtc().add(const Duration(minutes: 1)).toIso8601String(),
    }, expectedChallenge: 'challenge-for-model-test');
    expect(info.relayUrl, 'https://relay.example.test/');
    expect(info.deviceId, 'office-pc');
    expect(info.phoneToken, 'phone-token-for-model-test');
    expect(() => BluetoothBootstrapInfo.fromJson({
      'protocol_version': 1,
      'relay_url': 'https://relay.example.test',
      'device_id': 'office-pc',
      'phone_token': 'phone-token-for-model-test',
      'nonce': 'different-nonce-for-test',
      'challenge': 'challenge-for-model-test',
      'expires_at': DateTime.now().toUtc().add(const Duration(minutes: 1)).toIso8601String(),
    }, expectedChallenge: 'challenge-for-model-test', expectedNonce: 'nonce-for-model-test'), throwsFormatException);
  });

  test('Bluetooth bootstrap responses reject challenge mismatch and non-HTTPS relays', () {
    final payload = {
      'protocol_version': 1,
      'relay_url': 'https://relay.example.test',
      'device_id': 'office-pc',
      'phone_token': 'phone-token-for-model-test',
      'nonce': 'nonce-for-model-test',
      'challenge': 'challenge-for-model-test',
      'expires_at': DateTime.now().toUtc().add(const Duration(minutes: 1)).toIso8601String(),
    };
    expect(() => BluetoothBootstrapInfo.fromJson(payload, expectedChallenge: 'different-challenge'), throwsFormatException);
    expect(() => BluetoothBootstrapInfo.fromJson({...payload, 'relay_url': 'http://relay.example.test'}, expectedChallenge: 'challenge-for-model-test'), throwsFormatException);
  });
}
