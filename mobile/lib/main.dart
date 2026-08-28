import 'package:flutter/material.dart';

import 'data/repositories/remote_control_repository.dart';
import 'data/services/bridge_api_service.dart';
import 'data/services/bluetooth_bootstrap_service.dart';
import 'ui/core/theme/app_theme.dart';
import 'ui/features/control/view_models/control_view_model.dart';
import 'ui/features/control/views/control_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final service = BridgeApiService();
  final repository = RemoteControlRepository(api: service);
  final bluetoothService = BluetoothBootstrapService();
  final viewModel = ControlViewModel(repository: repository, bluetoothService: bluetoothService);
  runApp(DshRemoteApp(viewModel: viewModel));
}

class DshRemoteApp extends StatelessWidget {
  const DshRemoteApp({super.key, required this.viewModel});

  final ControlViewModel viewModel;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DSH Remote Control',
      theme: buildAppTheme(),
      home: ControlPage(viewModel: viewModel),
    );
  }
}
