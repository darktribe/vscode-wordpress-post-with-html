import * as vscode from 'vscode';
import matter from 'gray-matter';

export interface Contents {
  title: string;
  body: string;
  metadata: Record<string, any>;
}

export async function getContents(): Promise<Contents | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('アクティブなエディタが見つかりません。');
    return null;
  }

  const text = editor.document.getText().replace(/^\uFEFF/, ''); // BOM除去
  const parsed = matter(text);

  if (!parsed.data.title) {
    vscode.window.showErrorMessage('YAMLヘッダに title が指定されていません。');
    return null;
  }

  return {
    title: parsed.data.title,
    body: parsed.content,
    metadata: parsed.data
  };
}
