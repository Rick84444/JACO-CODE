'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { runtimeOrigin, probeJacoRuntime, makeWebviewHtml } = require('./lib/bridge.cjs');

let panel = null;

function runtimeUrl() {
  return runtimeOrigin(vscode.workspace.getConfiguration('jaco').get('runtimeUrl'));
}
function checkout() {
  const configured = String(vscode.workspace.getConfiguration('jaco').get('checkoutPath') || '').trim();
  const roots = configured
    ? [configured]
    : (vscode.workspace.workspaceFolders || []).filter(x => x.uri.scheme === 'file').map(x => x.uri.fsPath);
  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'agents', 'jaco-cli.mjs'))) return root;
  }
  throw new Error('Open JACO-CODE as a VS Code workspace or set jaco.checkoutPath in Settings.');
}

function openTerminalCommand(command) {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('Trust the JACO-CODE workspace before starting local processes.');
    return;
  }
  try {
    const cwd = checkout();
    // Explicit user command. No command line is formed from a workspace path or untrusted input.
    const terminal = vscode.window.createTerminal({
      name: command === 'activate' ? 'JACO Runtime' : 'JACO Terminal IDE',
      cwd,
      env: { JACO_VSCODE_EMBED: '1' },
    });
    terminal.show();
    terminal.sendText(command === 'activate'
      ? 'node agents/jaco-cli.mjs activate'
      : 'node agents/jaco-cli.mjs ide');
  } catch (error) {
    void vscode.window.showErrorMessage('JACO: ' + String(error?.message || error));
  }
}

async function openFullGUI(context) {
  let base;
  try {
    base = runtimeUrl();
    const connected = await probeJacoRuntime(base);
    if (panel) { panel.reveal(vscode.ViewColumn.One); return; }
    const mapped = await vscode.env.asExternalUri(vscode.Uri.parse(connected.embed));
    const mappedUrl = new URL(mapped.toString());
    if (!['http:', 'https:'].includes(mappedUrl.protocol)) {
      throw new Error('VS Code cannot forward the local JACO GUI to a Webview.');
    }
    const port = Number(new URL(base).port || 80);
    panel = vscode.window.createWebviewPanel(
      'jaco.fullIDE', 'JACO Cognitive IDE', vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [],
        portMapping: [{ webviewPort: port, extensionHostPort: port }] },
    );
    panel.webview.html = makeWebviewHtml(mapped.toString());
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'jaco.svg');
    panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);
  } catch (error) {
    const reason = String(error?.message || error);
    const message = reason === 'JACO_VSCODE_EMBED_DISABLED_OR_OUTDATED'
      ? 'JACO needs the updated runtime and JACO_VSCODE_EMBED=1 before the full GUI can appear inside VS Code.'
      : reason === 'JACO_VSCODE_LOCALHOST_ONLY'
        ? 'JACO Full IDE supports local loopback only. Remote pairing remains in the existing JACO Devices view.'
        : 'JACO Full IDE: ' + reason;
    const action = await vscode.window.showErrorMessage(message, 'Start JACO', 'Open in Browser');
    if (action === 'Start JACO') openTerminalCommand('activate');
    if (action === 'Open in Browser') await openBrowser();
  }
}

async function openBrowser() {
  try { await vscode.env.openExternal(vscode.Uri.parse(runtimeUrl())); }
  catch (error) { void vscode.window.showErrorMessage('JACO: ' + String(error?.message || error)); }
}

class WorkspaceTree {
  getTreeItem(element) { return element; }
  getChildren() {
    const entries = [
      ['Full JACO IDE', 'jaco.openFullGUI', 'Open the complete GUI in a VS Code editor tab'],
      ['Start JACO Runtime', 'jaco.startRuntime', 'Open a terminal using the canonical JACO launcher'],
      ['JACO Terminal IDE', 'jaco.openTerminal', 'Open the existing JACO CLI in the VS Code terminal'],
      ['Open in Browser', 'jaco.openBrowser', 'Open JACO directly if embedding is unavailable'],
    ];
    return entries.map(([label, command, tooltip]) => {
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.command = { command, title: label };
      item.tooltip = tooltip;
      item.contextValue = 'jaco';
      return item;
    });
  }
}

function activate(context) {
  const register = (id, action) => context.subscriptions.push(vscode.commands.registerCommand(id, action));
  register('jaco.openFullGUI', () => openFullGUI(context));
  register('jaco.startRuntime', () => openTerminalCommand('activate'));
  register('jaco.openTerminal', () => openTerminalCommand('ide'));
  register('jaco.openBrowser', openBrowser);
  // The JACO GUI's VS Code button. Only this fixed path opens anything; a link cannot pass parameters.
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: uri => { if (uri.path === '/open') void openFullGUI(context); },
  }));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('jaco.workspace', new WorkspaceTree()));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.text = '$(hubot) JACO';
  status.tooltip = 'Open JACO Full IDE';
  status.command = 'jaco.openFullGUI';
  status.show();
  context.subscriptions.push(status);
}
function deactivate() { if (panel) { panel.dispose(); panel = null; } }
module.exports = { activate, deactivate };
