import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";
import net from "node:net";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import iconv from "iconv-lite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3005);
const isProd = process.env.NODE_ENV === "production";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB limit
const FETCH_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const MAX_TEXT_CHARS = 60000;

function isPrivateOrLoopbackIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
    return true;
  }
  const v4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  if (!net.isIPv4(v4)) {
    return false;
  }
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("有効なURL形式ではありません。");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http または https のURLのみ解析できます。");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("ローカルおよび内部ネットワークのURLにはアクセスできません。");
  }

  if (net.isIP(host)) {
    if (isPrivateOrLoopbackIp(host)) {
      throw new Error("プライベートIPアドレスにはアクセスできません。");
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) {
      throw new Error("ホスト名を解決できませんでした。");
    }
    for (const rec of records) {
      if (isPrivateOrLoopbackIp(rec.address)) {
        throw new Error("プライベートIPアドレスへのアクセスは許可されていません。");
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("アクセス")) {
      throw err;
    }
    throw new Error("指定されたドメインが見つかりませんでした。");
  }

  return parsed;
}

async function fetchWithSafeRedirects(startUrl: string): Promise<{
  finalUrl: string;
  contentType: string;
  buffer: Buffer;
}> {
  let currentUrl = startUrl;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safeUrl = await assertSafePublicUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(safeUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
          "Cache-Control": "no-cache"
        }
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`リダイレクト先が不明です (HTTP ${res.status})。`);
        }
        currentUrl = new URL(location, safeUrl).toString();
        continue;
      }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error(`アクセスが制限されています (HTTP ${res.status})。ログインが必要なページやボット対策サイトは取得できません。`);
        }
        if (res.status === 404) {
          throw new Error("ページが見つかりませんでした (404 Not Found)。");
        }
        throw new Error(`ページの取得に失敗しました (HTTP ${res.status})。`);
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const isHtmlOrText =
        !contentType ||
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml") ||
        contentType.includes("text/plain") ||
        contentType.includes("application/xml");

      if (!isHtmlOrText) {
        throw new Error(`読み上げ非対応のファイル形式です (${contentType.split(";")[0]})。`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const ab = await res.arrayBuffer();
        return { finalUrl: safeUrl.toString(), contentType, buffer: Buffer.from(ab) };
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new Error("ページサイズが大きすぎるため読み込みを中断しました（上限5MB）。");
          }
          chunks.push(value);
        }
      }

      return {
        finalUrl: safeUrl.toString(),
        contentType,
        buffer: Buffer.concat(chunks)
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("ページの読み込みがタイムアウトしました。");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("リダイレクト回数が上限を超えました。");
}

function normalizeCharset(raw: string | null | undefined): string {
  if (!raw) return "utf-8";
  const cs = raw.trim().toLowerCase().replace(/["']/g, "");
  if (cs === "shift_jis" || cs === "shift-jis" || cs === "sjis" || cs === "x-sjis" || cs === "ms932" || cs === "windows-31j") {
    return "Shift_JIS";
  }
  if (cs === "euc-jp" || cs === "x-euc-jp" || cs === "eucjp") {
    return "EUC-JP";
  }
  if (cs === "iso-2022-jp") {
    return "ISO-2022-JP";
  }
  return iconv.encodingExists(cs) ? cs : "utf-8";
}

function decodeHtmlBuffer(buffer: Buffer, contentType: string): string {
  const headerMatch = contentType.match(/charset\s*=\s*([^\s;]+)/i);
  if (headerMatch?.[1]) {
    const cs = normalizeCharset(headerMatch[1]);
    if (iconv.encodingExists(cs)) {
      return iconv.decode(buffer, cs);
    }
  }

  const headSample = buffer.subarray(0, 4096).toString("latin1");
  const metaCharsetMatch =
    headSample.match(/<meta[^>]+charset\s*=\s*["']?([a-zA-Z0-9._-]+)/i) ||
    headSample.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9._-]+)/i);

  if (metaCharsetMatch?.[1]) {
    const cs = normalizeCharset(metaCharsetMatch[1]);
    if (iconv.encodingExists(cs)) {
      return iconv.decode(buffer, cs);
    }
  }

  return buffer.toString("utf-8");
}

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "canvas",
  "template",
  "figure",
  "figcaption",
  "picture",
  "nav",
  "footer",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  "[aria-hidden='true']",
  "[class*='pagination']",
  "[class*='Pagination']",
  "[class*='pager']",
  "[class*='Pager']",
  ".pagination",
  ".pager",
  ".ad",
  ".ads",
  ".advertisement",
  ".cookie-banner",
  ".share-buttons",
  ".sns-buttons",
  ".social-share",
  ".related-posts",
  ".recommend",
  ".toc",
  "#toc",
  ".table-of-contents",
  ".comments",
  "#comments",
  ".breadcrumb",
  ".breadcrumbs",
  ".sidebar",
  "#sidebar"
];

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "DT",
  "DD",
  "TR"
]);

function extractStructuredTextFromHtmlFragment(fragmentHtml: string): string {
  const fragDom = new JSDOM(`<body>${fragmentHtml}</body>`);
  const body = fragDom.window.document.body;

  // Prevent double reading of Japanese furigana (<rt>, <rp>)
  body.querySelectorAll("rt, rp").forEach((el) => el.remove());

  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const val = (node.nodeValue || "").replace(/\s+/g, " ");
      if (val) parts.push(val);
      return;
    }
    if (node.nodeType !== 1) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();

    if (tag === "BR") {
      parts.push("\n");
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push("\n");

    for (let i = 0; i < el.childNodes.length; i++) {
      walk(el.childNodes[i]);
    }

    if (isBlock) parts.push("\n");
  };

  walk(body);
  return parts.join("");
}

function cleanTextForReadAloud(raw: string): string {
  const lines = raw
    // Remove raw embedded URLs so TTS doesn't spell out https://...
    .replace(/https?:\/\/[^\s)）」』\]]+/gi, "")
    // Remove Wikipedia-style citation markers [1], [23], [要出典]
    .replace(/\[\s*(?:\d+|要出典|注\s*\d*|リンク切れ)\s*\]/g, "")
    // Remove decorative divider lines
    .replace(/^[━─═=\-*#・]{3,}$/gm, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      // Filter pagination & portal UI noise lines
      if (/^\d+\s*\/\s*\d+\s*ページ$/.test(line)) return false;
      if (/^(?:前へ|次へ|次のページ|前のページ|最初へ|最後へ|ページトップへ)$/.test(line)) return false;
      if (/^(?:次ページは|次のページは)[：:]/.test(line)) return false;
      if (/^【関連(?:リンク|記事)】$/.test(line)) return false;
      return true;
    });

  // Deduplicate consecutive identical lines (sometimes caused by nested blocks/headings)
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  return deduped.join("\n");
}

function getPageNumberFromUrl(u: URL): number {
  const qPage = u.searchParams.get("page") || u.searchParams.get("p");
  if (qPage && /^\d+$/.test(qPage)) {
    return parseInt(qPage, 10);
  }
  const pathMatch = u.pathname.match(/(?:\/page\/|\/|_)(\d+)(?:\.html?)?\/?$/i);
  if (pathMatch?.[1]) {
    const n = parseInt(pathMatch[1], 10);
    if (n >= 1 && n <= 50) return n;
  }
  return 1;
}

function getBaseArticlePath(pathname: string): string {
  return pathname
    .replace(/\/page\/\d+\/?$/i, "")
    .replace(/\/\d+\/?$/, "")
    .replace(/_\d+(\.html?)$/i, "$1")
    .replace(/\.html?$/i, "")
    .replace(/\/+$/, "");
}

function findNextPageUrl(doc: Document, currentUrl: string): string | null {
  let cur: URL;
  try {
    cur = new URL(currentUrl);
  } catch {
    return null;
  }
  const curNoHash = new URL(cur.toString());
  curNoHash.hash = "";

  const curPage = getPageNumberFromUrl(cur);
  const nextPage = curPage + 1;
  const curBasePath = getBaseArticlePath(cur.pathname);

  const candidates: { href: string; text: string; isRelNext: boolean }[] = [];

  doc.querySelectorAll("link[rel='next'], a[rel='next']").forEach((el) => {
    const href = el.getAttribute("href");
    if (href) {
      candidates.push({ href, text: (el.textContent || "").trim(), isRelNext: true });
    }
  });

  doc.querySelectorAll("a[href]").forEach((el) => {
    const href = el.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    candidates.push({ href, text: (el.textContent || "").trim(), isRelNext: false });
  });

  for (const cand of candidates) {
    let resolved: URL;
    try {
      resolved = new URL(cand.href, cur);
    } catch {
      continue;
    }
    if (resolved.origin !== cur.origin) continue;
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;

    resolved.hash = "";
    if (resolved.toString() === curNoHash.toString()) continue;

    // Never follow "next article" or "previous page" links
    if (/(?:前の|前へ|記事|一覧|コメント|トップ|戻る)/.test(cand.text)) continue;

    // Rule A: Query param pagination (?page=2, ?p=2) on the exact same article pathname
    const candQPage = resolved.searchParams.get("page") || resolved.searchParams.get("p");
    if (resolved.pathname === cur.pathname && candQPage && /^\d+$/.test(candQPage)) {
      if (parseInt(candQPage, 10) === nextPage) {
        return resolved.toString();
      }
      continue;
    }

    // Rule B: Path-based pagination (/article/2, /article/page/2, /article_2.html)
    const candBasePath = getBaseArticlePath(resolved.pathname);
    if (candBasePath && candBasePath === curBasePath) {
      const candPage = getPageNumberFromUrl(resolved);
      if (candPage === nextPage) {
        return resolved.toString();
      }
    }

    // Rule C: Explicit rel="next" with same article prefix and next-like indicator
    if (cand.isRelNext && curBasePath && resolved.pathname.startsWith(curBasePath)) {
      const candPage = getPageNumberFromUrl(resolved);
      if (candPage === nextPage || /^(?:次へ|次のページ|次ページ|next|>|≫)$/i.test(cand.text) || !cand.text) {
        return resolved.toString();
      }
    }
  }

  return null;
}

function extractReadablePage(html: string, finalUrl: string): {
  title: string;
  siteName: string;
  bodyText: string;
  nextPageUrl: string | null;
} {
  const dom = new JSDOM(html, { url: finalUrl });
  const doc = dom.window.document;

  // Detect pagination link BEFORE removing pagination DOM elements
  const nextPageUrl = findNextPageUrl(doc, finalUrl);

  const ogTitle = doc.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() || "";
  const docTitle = doc.title?.trim() || "";
  const ogSiteName = doc.querySelector("meta[property='og:site_name']")?.getAttribute("content")?.trim() || "";
  const metaDesc =
    doc.querySelector("meta[property='og:description']")?.getAttribute("content")?.trim() ||
    doc.querySelector("meta[name='description']")?.getAttribute("content")?.trim() ||
    "";

  // Remove furigana and noise elements (including figures/captions that inflate link density of lead paragraphs)
  doc.querySelectorAll("rt, rp").forEach((el) => el.remove());

  // Strip standalone promotional / related-article links inside paragraphs before Readability scores link density
  doc.querySelectorAll("a").forEach((a) => {
    const t = (a.textContent || "").trim();
    if (/^[▼▶▷◆■]|^(?:【関連|【あわせて|あわせて読みたい|次ページは[：:]|次のページは[：:])/.test(t)) {
      a.remove();
    }
  });

  for (const selector of NOISE_SELECTORS) {
    try {
      doc.querySelectorAll(selector).forEach((el) => el.remove());
    } catch {
      // ignore invalid selector
    }
  }

  const reader = new Readability(doc, { charThreshold: 120 });
  const parsed = reader.parse();

  const title = (parsed?.title || ogTitle || docTitle || "").trim();
  const siteName = (parsed?.siteName || ogSiteName || "").trim();

  let bodyText = "";
  if (parsed?.content) {
    bodyText = cleanTextForReadAloud(extractStructuredTextFromHtmlFragment(parsed.content));
  }

  // Fallback for pages where Readability couldn't isolate an <article>
  if (bodyText.length < 60) {
    const mainEl = doc.querySelector("main, article, [role='main']") || doc.body;
    if (mainEl) {
      const fallbackText = cleanTextForReadAloud(extractStructuredTextFromHtmlFragment(mainEl.innerHTML));
      if (fallbackText.length > bodyText.length) {
        bodyText = fallbackText;
      }
    }
  }

  // Fallback for JS-rendered SPA pages that only expose OGP/meta descriptions
  if (bodyText.length < 30 && metaDesc) {
    bodyText = cleanTextForReadAloud(metaDesc);
  }

  return { title, siteName, bodyText: bodyText.trim(), nextPageUrl };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/api/extract-url", async (req, res) => {
    try {
      const rawInput = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      if (!rawInput) {
        res.status(400).json({ ok: false, error: "URLを入力してください。" });
        return;
      }

      const followPages = req.body?.followPages !== false;
      const requestedMaxPages = typeof req.body?.maxPages === "number" ? req.body.maxPages : 5;
      const maxPages = followPages ? Math.max(1, Math.min(requestedMaxPages, 5)) : 1;

      const normalizedInput = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawInput)
        ? rawInput
        : `https://${rawInput}`;

      const firstFetch = await fetchWithSafeRedirects(normalizedInput);

      if (firstFetch.contentType.includes("text/plain")) {
        let plain = cleanTextForReadAloud(decodeHtmlBuffer(firstFetch.buffer, firstFetch.contentType));
        if (!plain) {
          res.status(422).json({ ok: false, error: "読み上げ可能なテキストが見つかりませんでした。" });
          return;
        }
        if (plain.length > MAX_TEXT_CHARS) {
          plain = plain.slice(0, MAX_TEXT_CHARS) + "\n\n（文字数上限に達したため、ここまでを抽出しました）";
        }
        res.json({
          ok: true,
          url: firstFetch.finalUrl,
          title: new URL(firstFetch.finalUrl).hostname,
          siteName: "",
          text: plain,
          charCount: plain.length,
          pagesLoaded: 1,
          nextPageUrl: null
        });
        return;
      }

      const firstHtml = decodeHtmlBuffer(firstFetch.buffer, firstFetch.contentType);
      const firstPage = extractReadablePage(firstHtml, firstFetch.finalUrl);
      const startPageNum = getPageNumberFromUrl(new URL(firstFetch.finalUrl));

      const visited = new Set<string>([firstFetch.finalUrl]);
      const pageBodies: { pageNum: number; bodyText: string }[] = [];
      if (firstPage.bodyText) {
        pageBodies.push({ pageNum: startPageNum, bodyText: firstPage.bodyText });
      }

      let pagesLoaded = 1;
      let nextPageUrl = firstPage.nextPageUrl;

      while (nextPageUrl && pagesLoaded < maxPages && !visited.has(nextPageUrl)) {
        visited.add(nextPageUrl);
        try {
          const nextFetch = await fetchWithSafeRedirects(nextPageUrl);
          if (nextFetch.contentType.includes("text/plain")) break;
          const nextHtml = decodeHtmlBuffer(nextFetch.buffer, nextFetch.contentType);
          const nextExtracted = extractReadablePage(nextHtml, nextFetch.finalUrl);
          if (nextExtracted.bodyText) {
            pageBodies.push({
              pageNum: getPageNumberFromUrl(new URL(nextFetch.finalUrl)) || startPageNum + pagesLoaded,
              bodyText: nextExtracted.bodyText
            });
            pagesLoaded++;
          }
          nextPageUrl = nextExtracted.nextPageUrl && !visited.has(nextExtracted.nextPageUrl)
            ? nextExtracted.nextPageUrl
            : null;
        } catch {
          // If fetching a subsequent page fails, preserve already extracted pages cleanly
          break;
        }
      }

      const finalLines: string[] = [];
      const pageBreaks: { lineIndex: number; pageNum: number }[] = [];

      const firstBodyFirstLine = pageBodies[0]?.bodyText.split("\n")[0]?.trim() || "";
      if (firstPage.title && (!firstBodyFirstLine || (!firstBodyFirstLine.includes(firstPage.title) && !firstPage.title.includes(firstBodyFirstLine)))) {
        finalLines.push(firstPage.title);
        if (pageBodies.length > 0) {
          finalLines.push("");
        }
      }

      pageBodies.forEach((p, idx) => {
        const pLines = p.bodyText.split("\n").filter((l) => l.trim().length > 0);
        if (!pLines.length) return;
        if (idx > 0) {
          finalLines.push("");
          pageBreaks.push({ lineIndex: finalLines.length, pageNum: p.pageNum });
        }
        finalLines.push(...pLines);
      });

      let finalText = finalLines.join("\n").trim();

      if (finalText.length > MAX_TEXT_CHARS) {
        finalText = finalText.slice(0, MAX_TEXT_CHARS) + "\n\n（文字数上限に達したため、ここまでを抽出しました）";
      }

      const maxLineCount = finalText.split("\n").length;
      const validPageBreaks = pageBreaks.filter((pb) => pb.lineIndex < maxLineCount);

      if (!finalText) {
        res.status(422).json({
          ok: false,
          error: "本文を抽出できませんでした（JavaScript専用ページまたはログインが必要なページの可能性があります）。"
        });
        return;
      }

      res.json({
        ok: true,
        url: firstFetch.finalUrl,
        title: firstPage.title,
        siteName: firstPage.siteName,
        text: finalText,
        charCount: finalText.length,
        pagesLoaded,
        nextPageUrl,
        pageBreaks: validPageBreaks
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "URLの解析中にエラーが発生しました。";
      res.status(400).json({ ok: false, error: message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
