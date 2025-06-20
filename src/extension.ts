import * as vscode from "vscode";
import { post } from "./post";

export function activate(context: vscode.ExtensionContext) {
  console.log("activate");

  const disposable = vscode.commands.registerCommand(
    "wordpress-post.post",
    async () => {
      try {
        await post();
      } catch (e: any) {
        vscode.window.showErrorMessage(e.message);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

