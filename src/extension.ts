"use strict";
import * as vscode from "vscode";
import {
  OnDidCloseTerminal,
  Run,
  RunCustomCommand,
  RunByLanguage,
  Stop,
  Dispose,
} from "./CodeManager";

export function activate(context: vscode.ExtensionContext) {
  vscode.window.onDidCloseTerminal(() => {
    OnDidCloseTerminal();
  });

  const run = vscode.commands.registerCommand(
    "code-runner.run",
    (fileUri: vscode.Uri) => {
      Run(null, fileUri);
    },
  );

  const runCustomCommand = vscode.commands.registerCommand(
    "code-runner.runCustomCommand",
    () => {
      RunCustomCommand();
    },
  );

  const runByLanguage = vscode.commands.registerCommand(
    "code-runner.runByLanguage",
    () => {
      RunByLanguage();
    },
  );

  const stop = vscode.commands.registerCommand("code-runner.stop", () => {
    Stop();
  });

  context.subscriptions.push(run);
  context.subscriptions.push(runCustomCommand);
  context.subscriptions.push(runByLanguage);
  context.subscriptions.push(stop);
}

export function deactivate() {
  Dispose();
}
