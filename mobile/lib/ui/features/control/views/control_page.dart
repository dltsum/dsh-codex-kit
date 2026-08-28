import 'package:flutter/material.dart';

import '../../../../domain/models.dart';
import '../view_models/control_view_model.dart';

class ControlPage extends StatefulWidget {
  const ControlPage({super.key, required this.viewModel});

  final ControlViewModel viewModel;

  @override
  State<ControlPage> createState() => _ControlPageState();
}

class _ControlPageState extends State<ControlPage> {
  late final TextEditingController _hostController;
  late final TextEditingController _portController;
  late final TextEditingController _pairingTokenController;
  late final TextEditingController _taskController;
  bool _codeMode = false;

  @override
  void initState() {
    super.initState();
    _hostController = TextEditingController(text: '127.0.0.1');
    _portController = TextEditingController(text: '8787');
    _pairingTokenController = TextEditingController();
    _taskController = TextEditingController();
  }

  @override
  void dispose() {
    _hostController.dispose();
    _portController.dispose();
    _pairingTokenController.dispose();
    _taskController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.viewModel,
      builder: (context, _) {
        final model = widget.viewModel;
        return Scaffold(
          appBar: AppBar(
            title: const Text('DSH 手机控制台'),
            actions: [
              if (model.isPaired)
                IconButton(
                  tooltip: '断开',
                  onPressed: model.busy ? null : model.disconnect,
                  icon: const Icon(Icons.link_off),
                ),
            ],
          ),
          body: RefreshIndicator(
            onRefresh: model.isPaired ? model.refresh : () async {},
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _buildSafetyNotice(context),
                const SizedBox(height: 12),
                if (!model.isPaired) _buildPairingCard(context, model),
                if (model.isPaired) ...[
                  _buildStatusCard(context, model),
                  const SizedBox(height: 12),
                  _buildTaskComposer(context, model),
                  const SizedBox(height: 12),
                  _buildTaskList(context, model),
                ],
                if (model.errorMessage != null) ...[
                  const SizedBox(height: 12),
                  _buildErrorCard(context, model.errorMessage!),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSafetyNotice(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.secondaryContainer,
      child: const Padding(
        padding: EdgeInsets.all(14),
        child: Text(
          '本 App 只控制你自己的 DSH 桥接器。默认本机监听；局域网连接使用 HTTP 明文，\n'
          '请只在可信 LAN 或 VPN 中使用，绝不要把 8787 端口转发到公网。',
        ),
      ),
    );
  }

  Widget _buildPairingCard(BuildContext context, ControlViewModel model) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('连接电脑端桥接器', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            const Text('在电脑运行 node remote/bridge.mjs，把终端显示的地址和配对令牌填在这里。'),
            const SizedBox(height: 16),
            TextField(
              controller: _hostController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: '电脑 IP / 主机名', hintText: '例如 192.168.1.20'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _portController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '端口', hintText: '8787'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _pairingTokenController,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(labelText: '一次性配对令牌'),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: model.busy ? null : _connect,
              icon: model.state == ControlState.pairing
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.link),
              label: const Text('连接'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusCard(BuildContext context, ControlViewModel model) {
    final snapshot = model.snapshot;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.computer, size: 32),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('已连接', style: Theme.of(context).textTheme.titleMedium),
                  Text(snapshot == null ? '正在读取状态…' : '运行中 ${snapshot.activeJobs}/${snapshot.maxJobs} 个任务'),
                ],
              ),
            ),
            IconButton(onPressed: model.busy ? null : model.refresh, icon: const Icon(Icons.refresh), tooltip: '刷新'),
          ],
        ),
      ),
    );
  }

  Widget _buildTaskComposer(BuildContext context, ControlViewModel model) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('提交 DSH 任务', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _taskController,
              minLines: 3,
              maxLines: 7,
              maxLength: 16000,
              decoration: const InputDecoration(
                labelText: '任务描述',
                hintText: '例如：检查当前仓库的测试失败原因并给出修复建议',
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Code Mode'),
              subtitle: const Text('只在确实需要代码工具时打开'),
              value: _codeMode,
              onChanged: (value) => setState(() => _codeMode = value),
            ),
            FilledButton.icon(
              onPressed: model.busy ? null : _submit,
              icon: model.state == ControlState.submitting
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.play_arrow),
              label: const Text('提交任务'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTaskList(BuildContext context, ControlViewModel model) {
    if (model.tasks.isEmpty) {
      return const Card(child: Padding(padding: EdgeInsets.all(18), child: Text('还没有任务。')));
    }
    return Card(
      child: Column(
        children: [
          const ListTile(title: Text('任务历史')),
          ...model.tasks.map((task) => _buildTaskTile(context, model, task)),
          if (model.selectedTask != null) _buildOutput(context, model.selectedTask!),
        ],
      ),
    );
  }

  Widget _buildTaskTile(BuildContext context, ControlViewModel model, RemoteTask task) {
    final selected = model.selectedTask?.id == task.id;
    return ListTile(
      selected: selected,
      leading: Icon(task.isActive ? Icons.sync : Icons.task_alt),
      title: Text(task.summary, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Text('${taskStatusLabel(task.status)} · ${task.id.substring(0, 8)}'),
      onTap: () => model.select(task),
      trailing: task.isActive
          ? IconButton(onPressed: () => model.cancel(task), icon: const Icon(Icons.stop_circle_outlined), tooltip: '取消')
          : null,
    );
  }

  Widget _buildOutput(BuildContext context, RemoteTask task) {
    final output = task.output.isEmpty ? '桥接器尚未返回输出。' : task.output;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Divider(),
          Text('输出', style: Theme.of(context).textTheme.titleMedium),
          if (task.outputTruncated)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text('输出过长，当前仅显示尾部。', style: TextStyle(fontStyle: FontStyle.italic)),
            ),
          const SizedBox(height: 8),
          SelectableText(output),
        ],
      ),
    );
  }

  Widget _buildErrorCard(BuildContext context, String message) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
          const Icon(Icons.error_outline),
          const SizedBox(width: 8),
          Expanded(child: Text(message)),
        ]),
      ),
    );
  }

  Future<void> _connect() async {
    await widget.viewModel.connect(
      host: _hostController.text,
      port: _portController.text,
      pairingToken: _pairingTokenController.text,
    );
    if (mounted && widget.viewModel.isPaired) _pairingTokenController.clear();
  }

  Future<void> _submit() async {
    final task = _taskController.text;
    await widget.viewModel.submit(task, codeMode: _codeMode);
    if (mounted && widget.viewModel.errorMessage == null) _taskController.clear();
  }
}
