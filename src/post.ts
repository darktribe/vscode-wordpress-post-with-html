import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as mime from 'mime-types';
import MarkdownIt from 'markdown-it';
import matter from 'gray-matter';
import { getContext } from './context';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import multimdTable from 'markdown-it-multimd-table';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

md.use(taskLists);
md.use(footnote);
md.use(multimdTable);

function extractRawHtmlBlocks(markdown: string): string {
  // HTMLコメントブロックを抽出する正しい正規表現パターン
  // この文字列が正規表現のパターンです
  const regexPattern = "<!--!(.*?)!-->"; // ← この全角文字の部分を、あなたが手動で半角に直してください
  return markdown.replace(new RegExp(regexPattern, 'gs'), (_, html) => html);
}

async function resolveCategoryIds(names: string[], apiBaseUrl: string, authHeader: string, language?: string): Promise<number[]> {
  const ids: number[] = [];

  for (const name of names) {
    let searchUrl = `${apiBaseUrl}/categories?search=${encodeURIComponent(name)}`;
    if (language) {
      searchUrl += `&lang=${encodeURIComponent(language)}`;
    }
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

async function findExistingPost(title: string, slug: string | undefined, apiBaseUrl: string, authHeader: string, language?: string): Promise<number | null> {
  try {
    if (slug) {
      let slugSearchUrl = `${apiBaseUrl}/posts?slug=${encodeURIComponent(slug)}&status=any`;
      if (language) {
        slugSearchUrl += `&lang=${encodeURIComponent(language)}`;
      }
      const slugRes = await fetch(slugSearchUrl, {
        headers: { Authorization: authHeader }
      });

      if (slugRes.ok) {
        const slugResults = await slugRes.json();
        if (slugResults.length > 0) {
          return slugResults[0].id;
        }
      }
    }

    let titleSearchUrl = `${apiBaseUrl}/posts?search=${encodeURIComponent(title)}&status=any`;
    if (language) {
      titleSearchUrl += `&lang=${encodeURIComponent(language)}`;
    }
    const titleRes = await fetch(titleSearchUrl, {
      headers: { Authorization: authHeader }
    });

    if (titleRes.ok) {
      const titleResults = await titleRes.json();
      const exactMatch = titleResults.find((post: any) => post.title.rendered === title);
      if (exactMatch) {
        return exactMatch.id;
      }
    }

    return null;
  } catch (error) {
    console.error('既存投稿の検索中にエラーが発生しました:', error);
    return null;
  }
}

async function uploadImage(filePath: string, altText: string, apiBaseUrl: string, authHeader: string): Promise<string | null> {
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
    const mediaId = json.id;
    const sourceUrl = json.source_url;

    if (altText && altText.trim()) {
      try {
        const updateRes = await fetch(`${apiBaseUrl}/media/${mediaId}`, {
          method: 'PATCH',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            alt_text: altText.trim()
          })
        });

        if (!updateRes.ok) {
          const errorText = await updateRes.text();
          vscode.window.showWarningMessage(`画像「${fileName}」のALT属性設定に失敗しました。\n${errorText}`);
        }
      } catch (updateErr) {
        vscode.window.showWarningMessage(`画像「${fileName}」のALT属性設定中にエラーが発生しました。\n${updateErr}`);
      }
    }

    return sourceUrl;
  } catch (err) {
    vscode.window.showWarningMessage(`画像「${filePath}」の読み込みに失敗しました。\n${err}`);
    return null;
  }
}

async function resolveTagIds(names: string[], apiBaseUrl: string, authHeader: string, language?: string): Promise<number[]> {
  const ids: number[] = [];

  for (const name of names) {
    let searchUrl = `${apiBaseUrl}/tags?search=${encodeURIComponent(name)}`;
    if (language) {
      searchUrl += `&lang=${encodeURIComponent(language)}`;
    }
    
    const res = await fetch(searchUrl, {
      headers: { Authorization: authHeader }
    });

    if (!res.ok) {
      vscode.window.showWarningMessage(`タグ「${name}」の検索に失敗しました。`);
      continue;
    }

    const results = await res.json();
    const match = results.find((tag: any) => tag.name === name || tag.slug === name);

    if (match) {
      ids.push(match.id);
    } else {
      try {
        const createData: any = { name: name };
        if (language) {
          createData.meta = { _locale: language };
        }
        
        const createRes = await fetch(`${apiBaseUrl}/tags`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(createData)
        });

        if (createRes.ok) {
          const newTag = await createRes.json();
          ids.push(newTag.id);
          vscode.window.showInformationMessage(`タグ「${name}」を新規作成しました。`);
        } else {
          vscode.window.showWarningMessage(`タグ「${name}」の作成に失敗しました。`);
        }
      } catch (error) {
        vscode.window.showWarningMessage(`タグ「${name}」の作成中にエラーが発生しました。`);
      }
    }
  }

  return ids;
}

function validateLanguageCode(language: string): boolean {
  const languageRegex = /^[a-z]{2}(-[a-z]{2})?$/i;
  return languageRegex.test(language);
}

async function replaceImagePaths(markdown: string, baseDir: string, apiBaseUrl: string, authHeader: string): Promise<string> {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const replacements: [string, string][] = [];

  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const alt = match[1];
    const relPath = match[2];

    if (relPath.startsWith('http://') || relPath.startsWith('https://')) {
      continue;
    }

    const absPath = path.resolve(baseDir, relPath);

    const uploadedUrl = await uploadImage(absPath, alt, apiBaseUrl, authHeader);
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

  let language: string | undefined = undefined;
  if (metadata.language) {
    if (typeof metadata.language === 'string' && validateLanguageCode(metadata.language)) {
      language = metadata.language.toLowerCase();
      vscode.window.showInformationMessage(`言語を「${language}」に設定しました。`);
    } else {
      vscode.window.showWarningMessage('無効な言語コードです。言語コード例: ja, en, fr, es, zh-cn, pt-br');
    }
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
  let html = md.render(preprocessed);

  // ★ ハッシュタグを記事の最初の行として挿入
  if (metadata.hashtag) {
    const hashtagLine = `<p>${metadata.hashtag}</p>\n`;
    html = hashtagLine + html;
  }

  let categoryIds: number[] | undefined = undefined;
  if (Array.isArray(metadata.categories)) {
    categoryIds = await resolveCategoryIds(metadata.categories, apiBaseUrl, authHeader, language);
  }

  let tagIds: number[] | undefined = undefined;
  if (Array.isArray(metadata.tags)) {
    tagIds = await resolveTagIds(metadata.tags, apiBaseUrl, authHeader, language);
  }

  const postData: Record<string, any> = {
    title: metadata.title,
    content: html,
    status: metadata.status || 'draft',
    slug: metadata.slug,
    date: metadata.date,
    categories: categoryIds,
    tags: tagIds
  };

  if (language) {
    postData.lang = language;
  }

  try {
    const existingPostId = await findExistingPost(metadata.title, metadata.slug, apiBaseUrl, authHeader, language);

    let res: Response;
    let actionMessage: string;

    if (existingPostId) {
      let updateUrl = `${apiBaseUrl}/posts/${existingPostId}`;
      if (language) {
        updateUrl += `?lang=${encodeURIComponent(language)}`;
      }
      res = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postData)
      });
      actionMessage = `記事を更新しました${language ? ` (言語: ${language})` : ''}。`;
    } else {
      let postUrl = `${apiBaseUrl}/posts`;
      if (language) {
        postUrl += `?lang=${encodeURIComponent(language)}`;
      }
      res = await fetch(postUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postData)
      });
      actionMessage = `記事を投稿しました${language ? ` (言語: ${language})` : ''}。`;
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`投稿に失敗しました: ${res.status} ${res.statusText}\n${errorText}`);
    }

    const result = await res.json();
    vscode.window.showInformationMessage(actionMessage);
    
    if (language) {
      console.log(`=== Polylang Debug Info ===`);
      console.log(`Language requested: ${language}`);
      console.log(`Post ID: ${result.id}`);
      console.log(`Post data sent:`, postData);
      console.log(`=== End Debug Info ===`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`投稿中にエラーが発生しました: ${err}`);
  }
}

export const post = postArticle;