import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as mime from 'mime-types';
import MarkdownIt from 'markdown-it';
import matter from 'gray-matter';
import { getContext } from './context';

const md = new MarkdownIt({ html: true });

function extractRawHtmlBlocks(markdown: string): string {
  return markdown.replace(/<!--!(.*?)!-->/gs, (_, html) => html);
}

async function resolveCategoryIds(names: string[], apiBaseUrl: string, authHeader: string): Promise<number[]> {
  const ids: number[] = [];

  for (const name of names) {
    const searchUrl = `${apiBaseUrl}/categories?search=${encodeURIComponent(name)}`;
    const res = await fetch(searchUrl, {
      headers: { Authorization: authHeader }
    });

    if (!res.ok) {
      vscode.window.showWarningMessage(`カテゴリ「${name}」の検索に失敗しました。`);
      continue;
    }

    const results = await res.json();
    const match = results.find((cat: any) => cat.name === name || cat.slug === name);

    if (match) {
      ids.push(match.id);
    } else {
      vscode.window.showWarningMessage(`カテゴリ「${name}」が見つかりませんでした。`);
    }
  }

  return ids;
}

async function uploadImage(filePath: string, apiBaseUrl: string, authHeader: string): Promise<string | null> {
  try {
    const fileName = path.basename(filePath);
    const fileData = await fs.readFile(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';

    const res = await fetch(`${apiBaseUrl}/media`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Type': mimeType
      },
      body: fileData
    });

    if (!res.ok) {
      const errorText = await res.text();
      vscode.window.showWarningMessage(`画像「${fileName}」のアップロードに失敗しました。\n${errorText}`);
      return null;
    }

    const json = await res.json();
    return json.source_url;
  } catch (err) {
    vscode.window.showWarningMessage(`画像「${filePath}」の読み込みに失敗しました。\n${err}`);
    return null;
  }
}

async function replaceImagePaths(markdown: string, baseDir: string, apiBaseUrl: string, authHeader: string): Promise<string> {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const replacements: [string, string][] = [];

  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const alt = match[1];
    const relPath = match[2];
    const absPath = path.resolve(baseDir, relPath);

    const uploadedUrl = await uploadImage(absPath, apiBaseUrl, authHeader);
    if (uploadedUrl) {
      const original = match[0];
      const replacement = `![${alt}](${uploadedUrl})`;
      replacements.push([original, replacement]);
    }
  }

  let updated = markdown;
  for (const [original, replacement] of replacements) {
    updated = updated.replace(original, replacement);
  }

  return updated;
}

export async function postArticle() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('アクティブなエディタが見つかりません。');
    return;
  }

  const rawText = editor.document.getText().replace(/^\uFEFF/, '');
  const parsed = matter(rawText);
  const metadata = parsed.data;
  const markdownBody = parsed.content;

  if (!metadata.title) {
    vscode.window.showErrorMessage('YAMLヘッダに title が指定されていません。');
    return;
  }

  const context = await getContext();
  if (!context) {
    vscode.window.showErrorMessage('WordPressの設定が取得できませんでした。');
    return;
  }

  const authHeader = `Basic ${Buffer.from(`${context.user}:${context.password}`).toString('base64')}`;
  const apiBaseUrl = context.url.replace(/\/$/, '');

  const docPath = editor.document.uri.fsPath;
  const baseDir = path.dirname(docPath);

  const withUploadedImages = await replaceImagePaths(markdownBody, baseDir, apiBaseUrl, authHeader);
  const preprocessed = extractRawHtmlBlocks(withUploadedImages);
  const html = md.render(preprocessed);

  let categoryIds: number[] | undefined = undefined;
  if (Array.isArray(metadata.categories)) {
    categoryIds = await resolveCategoryIds(metadata.categories, apiBaseUrl, authHeader);
  }

  const postData: Record<string, any> = {
    title: metadata.title,
    content: html,
    status: metadata.status || 'draft',
    slug: metadata.slug,
    date: metadata.date,
    categories: categoryIds
  };

  try {
    const postUrl = `${apiBaseUrl}/posts`;
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`投稿に失敗しました: ${res.status} ${res.statusText}\n${errorText}`);
    }

    vscode.window.showInformationMessage('記事を投稿しました。');
  } catch (err) {
    vscode.window.showErrorMessage(`投稿中にエラーが発生しました: ${err}`);
  }
}

export const post = postArticle;
