"use strict";
import * as vscode from "vscode";
import { Constants } from "./Constants";

export async function GetPythonPath(
  document: vscode.TextDocument,
): Promise<string> {
  try {
    const extension = vscode.extensions.getExtension("ms-python.python");
    if (!extension) {
      return Constants.python;
    }
    const usingNewInterpreterStorage =
      extension.packageJSON?.featureFlags?.usingNewInterpreterStorage;
    if (usingNewInterpreterStorage) {
      if (!extension.isActive) {
        await extension.activate();
      }
      const execCommand = extension.exports.settings.getExecutionDetails
        ? extension.exports.settings.getExecutionDetails(document?.uri)
            .execCommand
        : extension.exports.settings.getExecutionCommand(document?.uri);
      return execCommand ? execCommand.join(" ") : Constants.python;
    } else {
      return UtilityGetConfiguration("python", document).get<string>(
        "pythonPath",
      );
    }
  } catch (error) {
    return Constants.python;
  }
}

export function UtilityGetConfiguration(
  section?: string,
  document?: vscode.TextDocument,
): vscode.WorkspaceConfiguration {
  if (document) {
    return vscode.workspace.getConfiguration(section, document.uri);
  } else {
    return vscode.workspace.getConfiguration(section);
  }
}
