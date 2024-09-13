"use strict";
import * as fs from "fs";
import * as micromatch from "micromatch";
import * as os from "os";
import { basename, dirname, extname, join } from "path";
import * as vscode from "vscode";
import { Constants } from "./constants";
import { GetPythonPath, UtilityGetConfiguration } from "./utils";

const TmpDir = os.tmpdir();
let outputChannel: vscode.OutputChannel =
  vscode.window.createOutputChannel("Code");
let terminal: vscode.Terminal = null;
let isRunning: boolean = false;
let process;
let codeFile: string;
let isTmpFile: boolean;
let languageId: string;
let cwd: string;
let runFromExplorer: boolean;
let document: vscode.TextDocument;
let workspaceFolder: string;
let config: vscode.WorkspaceConfiguration;
let TERMINAL_DEFAULT_SHELL_WINDOWS: string | null = null;

export function OnDidCloseTerminal(): void {
  terminal = null;
}

export async function Run(
  languageIdParam: string = null,
  fileUri: vscode.Uri = null,
) {
  if (isRunning) {
    vscode.window.showInformationMessage("Code is already running!");
    return;
  }

  runFromExplorer = CheckIsRunFromExplorer(fileUri);
  if (runFromExplorer) {
    document = await vscode.workspace.openTextDocument(fileUri);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      document = editor.document;
    } else {
      vscode.window.showInformationMessage("No code found or selected.");
      return;
    }
  }

  Initialize();

  const fileExtension = extname(document.fileName);
  const executor = GetExecutor(languageIdParam, fileExtension);
  if (executor == null) {
    vscode.window.showInformationMessage(
      "Code language not supported or defined.",
    );
    return;
  }

  GetCodeFileAndExecute(fileExtension, executor);
}

export function RunCustomCommand(): void {
  if (isRunning) {
    vscode.window.showInformationMessage("Code is already running!");
    return;
  }

  runFromExplorer = false;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    document = editor.document;
  }

  Initialize();

  const executor = config.get<string>("customCommand");

  if (document) {
    const fileExtension = extname(document.fileName);
    GetCodeFileAndExecute(fileExtension, executor, false);
  } else {
    ExecuteCommand(executor, false);
  }
}

export function RunByLanguage(): void {
  const config = GetConfiguration("code-runner");
  const executorMap = config.get<any>("executorMap");
  vscode.window
    .showQuickPick(Object.keys(executorMap), {
      placeHolder: "Type or select language to run",
    })
    .then((languageId) => {
      if (languageId !== undefined) {
        Run(languageId);
      }
    });
}

export function Stop(): void {
  StopRunning();
}

export function Dispose() {
  StopRunning();
}

function CheckIsRunFromExplorer(fileUri: vscode.Uri): boolean {
  const editor = vscode.window.activeTextEditor;
  if (!fileUri || !fileUri.fsPath) {
    return false;
  }
  if (!editor) {
    return true;
  }
  if (fileUri.fsPath === editor.document.uri.fsPath) {
    return false;
  }
  return true;
}

function StopRunning() {
  if (isRunning) {
    isRunning = false;
    vscode.commands.executeCommand(
      "setContext",
      "code-runner.codeRunning",
      false,
    );
    const kill = require("tree-kill");
    kill(process.pid);
  }
}

function Initialize(): void {
  config = GetConfiguration("code-runner");
  cwd = config.get<string>("cwd");
  if (cwd) {
    return;
  }
  workspaceFolder = GetWorkspaceFolder();
  if (
    (config.get<boolean>("fileDirectoryAsCwd") || !workspaceFolder) &&
    document &&
    !document.isUntitled
  ) {
    cwd = dirname(document.fileName);
  } else {
    cwd = workspaceFolder;
  }
  if (cwd) {
    return;
  }
  cwd = TmpDir;
}

function GetConfiguration(section?: string): vscode.WorkspaceConfiguration {
  return UtilityGetConfiguration(section, document);
}

function GetWorkspaceFolder(): string {
  if (vscode.workspace.workspaceFolders) {
    if (document) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (workspaceFolder) {
        return workspaceFolder.uri.fsPath;
      }
    }
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  } else {
    return undefined;
  }
}

function GetCodeFileAndExecute(
  fileExtension: string,
  executor: string,
  appendFile: boolean = true,
): any {
  let selection;
  const activeTextEditor = vscode.window.activeTextEditor;
  if (activeTextEditor) {
    selection = activeTextEditor.selection;
  }
  const ignoreSelection = config.get<boolean>("ignoreSelection");

  if (
    (runFromExplorer || !selection || selection.isEmpty || ignoreSelection) &&
    !document.isUntitled
  ) {
    isTmpFile = false;
    codeFile = document.fileName;

    if (config.get<boolean>("saveAllFilesBeforeRun")) {
      return vscode.workspace.saveAll().then(() => {
        ExecuteCommand(executor, appendFile);
      });
    }

    if (config.get<boolean>("saveFileBeforeRun")) {
      return document.save().then(() => {
        ExecuteCommand(executor, appendFile);
      });
    }
  } else {
    let text =
      runFromExplorer || !selection || selection.isEmpty || ignoreSelection
        ? document.getText()
        : document.getText(selection);

    if (languageId === "php") {
      text = text.trim();
      if (!text.startsWith("<?php")) {
        text = "<?php\r\n" + text;
      }
    }

    isTmpFile = true;
    const folder = document.isUntitled ? cwd : dirname(document.fileName);
    CreateRandomFile(text, folder, fileExtension);
  }

  ExecuteCommand(executor, appendFile);
}

function RndName(): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .substr(0, 10);
}

function CreateRandomFile(
  content: string,
  folder: string,
  fileExtension: string,
) {
  let fileType = "";
  const languageIdToFileExtensionMap = config.get<any>(
    "languageIdToFileExtensionMap",
  );
  if (languageId && languageIdToFileExtensionMap[languageId]) {
    fileType = languageIdToFileExtensionMap[languageId];
  } else {
    if (fileExtension) {
      fileType = fileExtension;
    } else {
      fileType = "." + languageId;
    }
  }
  const temporaryFileName = config.get<string>("temporaryFileName");
  const tmpFileNameWithoutExt = temporaryFileName
    ? temporaryFileName
    : "temp" + RndName();
  const tmpFileName = tmpFileNameWithoutExt + fileType;
  codeFile = join(folder, tmpFileName);
  fs.writeFileSync(codeFile, content);
}

function GetExecutor(languageIdParam: string, fileExtension: string): string {
  languageId = languageIdParam === null ? document.languageId : languageIdParam;

  let executor = null;

  if (languageIdParam == null && config.get<boolean>("respectShebang")) {
    const firstLineInFile = document.lineAt(0).text;
    if (/^#!(?!\[)/.test(firstLineInFile)) {
      executor = firstLineInFile.slice(2);
    }
  }

  if (executor == null) {
    const executorMapByGlob = config.get<any>("executorMapByGlob");
    if (executorMapByGlob) {
      const fileBasename = basename(document.fileName);
      for (const glob of Object.keys(executorMapByGlob)) {
        if (micromatch.isMatch(fileBasename, glob)) {
          executor = executorMapByGlob[glob];
          break;
        }
      }
    }
  }

  const executorMap = config.get<any>("executorMap");

  if (executor == null) {
    executor = executorMap[languageId];
  }

  if (executor == null && fileExtension) {
    const executorMapByFileExtension = config.get<any>(
      "executorMapByFileExtension",
    );
    executor = executorMapByFileExtension[fileExtension];
    if (executor != null) {
      languageId = fileExtension;
    }
  }
  if (executor == null) {
    languageId = config.get<string>("defaultLanguage");
    executor = executorMap[languageId];
  }

  return executor;
}

function ExecuteCommand(executor: string, appendFile: boolean = true) {
  if (config.get<boolean>("runInTerminal")) {
    ExecuteCommandInTerminal(executor, appendFile);
  } else {
    ExecuteCommandInOutputChannel(executor, appendFile);
  }
}

function GetWorkspaceRoot(codeFileDir: string): string {
  return workspaceFolder ? workspaceFolder : codeFileDir;
}

function GetCodeBaseFile(): string {
  const regexMatch = codeFile.match(/.*[\/\\](.*)/);
  return regexMatch ? regexMatch[1] : codeFile;
}

function GetCodeFileWithoutDirAndExt(): string {
  const regexMatch = codeFile.match(/.*[\/\\](.*(?=\..*))/);
  return regexMatch ? regexMatch[1] : codeFile;
}

function GetCodeFileDir(): string {
  const regexMatch = codeFile.match(/(.*[\/\\]).*/);
  return regexMatch ? regexMatch[1] : codeFile;
}

function GetDriveLetter(): string {
  const regexMatch = codeFile.match(/^([A-Za-z]:).*/);
  return regexMatch ? regexMatch[1] : "$driveLetter";
}

function GetCodeFileDirWithoutTrailingSlash(): string {
  return GetCodeFileDir().replace(/[\/\\]$/, "");
}

function QuoteFileName(fileName: string): string {
  return '"' + fileName + '"';
}

async function GetFinalCommandToRunCodeFile(
  executor: string,
  appendFile: boolean = true,
): Promise<string> {
  let cmd = executor;

  if (codeFile) {
    const codeFileDir = GetCodeFileDir();
    const pythonPath = cmd.includes("$pythonPath")
      ? await GetPythonPath(document)
      : Constants.python;
    const placeholders: Array<{ regex: RegExp; replaceValue: string }> = [
      {
        regex: /\$workspaceRoot/g,
        replaceValue: GetWorkspaceRoot(codeFileDir),
      },
      {
        regex: /\$fileNameWithoutExt/g,
        replaceValue: GetCodeFileWithoutDirAndExt(),
      },
      { regex: /\$fullFileName/g, replaceValue: QuoteFileName(codeFile) },
      { regex: /\$fileName/g, replaceValue: GetCodeBaseFile() },
      { regex: /\$driveLetter/g, replaceValue: GetDriveLetter() },
      {
        regex: /\$dirWithoutTrailingSlash/g,
        replaceValue: QuoteFileName(GetCodeFileDirWithoutTrailingSlash()),
      },
      { regex: /\$dir/g, replaceValue: QuoteFileName(codeFileDir) },
      { regex: /\$pythonPath/g, replaceValue: pythonPath },
    ];

    placeholders.forEach((placeholder) => {
      cmd = cmd.replace(placeholder.regex, placeholder.replaceValue);
    });
  }

  return cmd !== executor
    ? cmd
    : executor + (appendFile ? " " + QuoteFileName(codeFile) : "");
}

function ChangeExecutorFromCmdToPs(executor: string): string {
  if (executor.includes(" && ") && IsPowershellOnWindows()) {
    let replacement = "; if ($?) {";
    executor = executor.replace("&&", replacement);
    replacement = "} " + replacement;
    executor = executor.replace(/&&/g, replacement);
    executor = executor.replace(
      /\$dir\$fileNameWithoutExt/g,
      ".\\$fileNameWithoutExt",
    );
    return executor + " }";
  }
  return executor;
}

function IsPowershellOnWindows(): boolean {
  if (os.platform() === "win32") {
    const defaultProfile = vscode.workspace
      .getConfiguration("terminal")
      .get<string>("integrated.defaultProfile.windows");
    if (defaultProfile) {
      if (defaultProfile.toLowerCase().includes("powershell")) {
        return true;
      } else if (defaultProfile === "Command Prompt") {
        return false;
      }
    }
    const windowsShell = vscode.env.shell;
    return windowsShell && windowsShell.toLowerCase().includes("powershell");
  }
  return false;
}

function ChangeFilePathForBashOnWindows(command: string): string {
  if (os.platform() === "win32") {
    const windowsShell = vscode.env.shell;
    const terminalRoot = config.get<string>("terminalRoot");
    if (windowsShell && terminalRoot) {
      command = command
        .replace(
          /([A-Za-z]):\\/g,
          (match, p1) => `${terminalRoot}${p1.toLowerCase()}/`,
        )
        .replace(/\\/g, "/");
    } else if (
      windowsShell &&
      windowsShell.toLowerCase().indexOf("bash") > -1 &&
      windowsShell.toLowerCase().indexOf("windows") > -1
    ) {
      command = command.replace(/([A-Za-z]):\\/g, Replacer).replace(/\\/g, "/");
    }
  }
  return command;
}

function Replacer(match: string, p1: string): string {
  return `/mnt/${p1.toLowerCase()}/`;
}

async function ExecuteCommandInTerminal(
  executor: string,
  appendFile: boolean = true,
) {
  let isNewTerminal = false;
  if (terminal === null) {
    terminal = vscode.window.createTerminal("Code");
    isNewTerminal = true;
  }
  terminal.show(config.get<boolean>("preserveFocus"));
  executor = ChangeExecutorFromCmdToPs(executor);
  let command = await GetFinalCommandToRunCodeFile(executor, appendFile);
  command = ChangeFilePathForBashOnWindows(command);
  if (config.get<boolean>("clearPreviousOutput") && !isNewTerminal) {
    await vscode.commands.executeCommand("workbench.action.terminal.clear");
  }
  if (config.get<boolean>("fileDirectoryAsCwd")) {
    const cwdPath = ChangeFilePathForBashOnWindows(cwd);
    terminal.sendText(`cd "${cwdPath}"`);
  }
  terminal.sendText(command);
}

async function ExecuteCommandInOutputChannel(
  executor: string,
  appendFile: boolean = true,
) {
  isRunning = true;
  vscode.commands.executeCommand("setContext", "code-runner.codeRunning", true);
  const clearPreviousOutput = config.get<boolean>("clearPreviousOutput");
  if (clearPreviousOutput) {
    outputChannel.clear();
  }
  const showExecutionMessage = config.get<boolean>("showExecutionMessage");
  outputChannel.show(config.get<boolean>("preserveFocus"));
  const spawn = require("child_process").spawn;
  const command = await GetFinalCommandToRunCodeFile(executor, appendFile);
  if (showExecutionMessage) {
    outputChannel.appendLine("[Running] " + command);
  }
  const startTime = new Date();
  process = spawn(command, [], { cwd: cwd, shell: true });

  process.stdout.on("data", (data) => {
    outputChannel.append(data.toString());
  });

  process.stderr.on("data", (data) => {
    outputChannel.append(data.toString());
  });

  process.on("close", (code) => {
    isRunning = false;
    vscode.commands.executeCommand(
      "setContext",
      "code-runner.codeRunning",
      false,
    );
    const endTime = new Date();
    const elapsedTime = (endTime.getTime() - startTime.getTime()) / 1000;
    outputChannel.appendLine("");
    if (showExecutionMessage) {
      outputChannel.appendLine(
        "[Done] exited with code=" + code + " in " + elapsedTime + " seconds",
      );
      outputChannel.appendLine("");
    }
    if (isTmpFile) {
      fs.unlinkSync(codeFile);
    }
  });
}
