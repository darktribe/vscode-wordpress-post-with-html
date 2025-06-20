import * as vscode from 'vscode';

export class Context {
  url: string = '';
  user: string = '';
  password: string = '';

  async load(): Promise<Context | null> {
    const config = vscode.workspace.getConfiguration('wordpress-post');
    this.url = config.get<string>('apiUrl') || '';
    this.user = config.get<string>('authUser') || '';
    this.password = config.get<string>('authPassword') || '';

    if (!this.url || !this.user || !this.password) {
      vscode.window.showErrorMessage('WordPress の設定が不完全です。');
      return null;
    }

    return this;
  }
}

export async function getContext(): Promise<Context | null> {
  const ctx = new Context();
  return await ctx.load();
}
