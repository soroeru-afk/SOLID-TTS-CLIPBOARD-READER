import { Readability } from "@mozilla/readability";

export interface PageBreakMarker {
  lineIndex: number;
  pageNum: number;
}

export interface ClientUrlExtractResult {
  ok: true;
  url: string;
  title: string;
  siteName: string;
  text: string;
  charCount: number;
  pagesLoaded: number;
  nextPageUrl: string | null;
  pageBreaks: PageBreakMarker[];
}

const FETCH_TIMEOUT_MS = 14000;
const MAX_TEXT_CHARS = 60000;

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
  "header",
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

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [, a, b] = m.map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function normalizeTargetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("URLを入力してください。");
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("有効なURL形式ではありません。");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http または https のURLのみ解析できます。");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("ローカルおよび内部ネットワークのURLにはアクセスできません。");
  }
  return parsed.toString();
}

function normalizeCharset(raw: string | null | undefined): string {
  if (!raw) return "utf-8";
  const cs = raw.trim().toLowerCase().replace(/["']/g, "");
  if (cs === "shift_jis" || cs === "shift-jis" || cs === "sjis" || cs === "x-sjis" || cs === "ms932" || cs === "windows-31j") {
    return "shift_jis";
  }
  if (cs === "euc-jp" || cs === "x-euc-jp" || cs === "eucjp") {
    return "euc-jp";
  }
  if (cs === "iso-2022-jp") {
    return "iso-2022-jp";
  }
  return cs || "utf-8";
}

function decodeArrayBuffer(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);
  const headerMatch = contentType.match(/charset\s*=\s*([^\s;]+)/i);
  if (headerMatch?.[1]) {
    try {
      return new TextDecoder(normalizeCharset(headerMatch[1])).decode(bytes);
    } catch {
      // fallback below
    }
  }

  let headSample = "";
  const sampleBytes = bytes.subarray(0, 4096);
  for (let i = 0; i < sampleBytes.length; i++) {
    headSample += String.fromCharCode(sampleBytes[i]);
  }
  const metaMatch =
    headSample.match(/<meta[^>]+charset\s*=\s*["']?([a-zA-Z0-9._-]+)/i) ||
    headSample.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9._-]+)/i);

  if (metaMatch?.[1]) {
    try {
      return new TextDecoder(normalizeCharset(metaMatch[1])).decode(bytes);
    } catch {
      // fallback below
    }
  }

  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  outerSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (outerSignal) {
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }
}

async function fetchHtmlViaCorsProxy(
  targetUrl: string,
  outerSignal?: AbortSignal
): Promise<{ html: string; isPlainText: boolean }> {
  const attempts: Array<() => Promise<{ html: string; isPlainText: boolean } | null>> = [
    // 1. r.jina.ai raw HTML mode (returns full HTML cleanly over CORS)
    async () => {
      const res = await fetchWithTimeout(
        `https://r.jina.ai/${targetUrl}`,
        {
          method: "GET",
          headers: { "X-Respond-With": "html" }
        },
        outerSignal
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text.trim().length < 20) return null;
      const hasHtmlTag = /<(?:!doctype|html|head|body|article|main|p|div)\b/i.test(text);
      if (!hasHtmlTag) return null;
      return { html: text, isPlainText: false };
    },
    // 2. allorigins raw relay
    async () => {
      const res = await fetchWithTimeout(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        { method: "GET" },
        outerSignal
      );
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const buf = await res.arrayBuffer();
      const text = decodeArrayBuffer(buf, ct);
      if (!text || text.trim().length < 20) return null;
      return { html: text, isPlainText: ct.includes("text/plain") };
    },
    // 3. codetabs raw relay
    async () => {
      const res = await fetchWithTimeout(
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
        { method: "GET" },
        outerSignal
      );
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const buf = await res.arrayBuffer();
      const text = decodeArrayBuffer(buf, ct);
      if (!text || text.trim().length < 20) return null;
      return { html: text, isPlainText: ct.includes("text/plain") };
    }
  ];

  for (const attempt of attempts) {
    if (outerSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const result = await attempt();
      if (result) return result;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError" && outerSignal?.aborted) {
        throw err;
      }
      // Try next relay
    }
  }

  throw new Error(
    "Webページの取得に失敗しました（サイト側の制限・ログイン必須・または一時的な通信エラーの可能性があります）。"
  );
}

function extractStructuredTextFromHtmlFragment(fragmentHtml: string): string {
  const parser = new DOMParser();
  const fragDoc = parser.parseFromString(`<!doctype html><html><body>${fragmentHtml}</body></html>`, "text/html");
  const body = fragDoc.body;

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
    .replace(/https?:\/\/[^\s)）」』\]]+/gi, "")
    .replace(/\[\s*(?:\d+|要出典|注\s*\d*|リンク切れ)\s*\]/g, "")
    .replace(/^[━─═=\-*#・]{3,}$/gm, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (/^\d+\s*\/\s*\d+\s*ページ$/.test(line)) return false;
      if (/^(?:前へ|次へ|次のページ|前のページ|最初へ|最後へ|ページトップへ)$/.test(line)) return false;
      if (/^(?:次ページは|次のページは)[：:]/.test(line)) return false;
      if (/^【関連(?:リンク|記事)】$/.test(line)) return false;
      return true;
    });

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

    if (/(?:前の|前へ|記事|一覧|コメント|トップ|戻る)/.test(cand.text)) continue;

    const candQPage = resolved.searchParams.get("page") || resolved.searchParams.get("p");
    if (resolved.pathname === cur.pathname && candQPage && /^\d+$/.test(candQPage)) {
      if (parseInt(candQPage, 10) === nextPage) {
        return resolved.toString();
      }
      continue;
    }

    const candBasePath = getBaseArticlePath(resolved.pathname);
    if (candBasePath && candBasePath === curBasePath) {
      const candPage = getPageNumberFromUrl(resolved);
      if (candPage === nextPage) {
        return resolved.toString();
      }
    }

    if (cand.isRelNext && curBasePath && resolved.pathname.startsWith(curBasePath)) {
      const candPage = getPageNumberFromUrl(resolved);
      if (candPage === nextPage || /^(?:次へ|次のページ|次ページ|next|>|≫)$/i.test(cand.text) || !cand.text) {
        return resolved.toString();
      }
    }
  }

  return null;
}

function extractReadablePageFromHtml(html: string, finalUrl: string): {
  title: string;
  siteName: string;
  bodyText: string;
  nextPageUrl: string | null;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Ensure relative URLs resolve against the fetched page URL rather than the PWA origin
  if (doc.head && !doc.head.querySelector("base")) {
    const baseEl = doc.createElement("base");
    baseEl.setAttribute("href", finalUrl);
    doc.head.prepend(baseEl);
  }

  const nextPageUrl = findNextPageUrl(doc, finalUrl);

  const ogTitle = doc.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() || "";
  const docTitle = doc.title?.trim() || "";
  const ogSiteName = doc.querySelector("meta[property='og:site_name']")?.getAttribute("content")?.trim() || "";
  const metaDesc =
    doc.querySelector("meta[property='og:description']")?.getAttribute("content")?.trim() ||
    doc.querySelector("meta[name='description']")?.getAttribute("content")?.trim() ||
    "";

  doc.querySelectorAll("rt, rp").forEach((el) => el.remove());

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

  if (bodyText.length < 60) {
    const mainEl = doc.querySelector("main, article, [role='main']") || doc.body;
    if (mainEl) {
      const fallbackText = cleanTextForReadAloud(extractStructuredTextFromHtmlFragment(mainEl.innerHTML));
      if (fallbackText.length > bodyText.length) {
        bodyText = fallbackText;
      }
    }
  }

  if (bodyText.length < 30 && metaDesc) {
    bodyText = cleanTextForReadAloud(metaDesc);
  }

  return { title, siteName, bodyText: bodyText.trim(), nextPageUrl };
}

export async function extractUrlClientSide(
  rawInput: string,
  options?: { followPages?: boolean; maxPages?: number; signal?: AbortSignal }
): Promise<ClientUrlExtractResult> {
  const targetUrl = normalizeTargetUrl(rawInput);
  const followPages = options?.followPages !== false;
  const requestedMaxPages = typeof options?.maxPages === "number" ? options.maxPages : 5;
  const maxPages = followPages ? Math.max(1, Math.min(requestedMaxPages, 5)) : 1;

  const firstFetch = await fetchHtmlViaCorsProxy(targetUrl, options?.signal);

  if (firstFetch.isPlainText) {
    let plain = cleanTextForReadAloud(firstFetch.html);
    if (!plain) {
      throw new Error("読み上げ可能なテキストが見つかりませんでした。");
    }
    if (plain.length > MAX_TEXT_CHARS) {
      plain = plain.slice(0, MAX_TEXT_CHARS) + "\n\n（文字数上限に達したため、ここまでを抽出しました）";
    }
    return {
      ok: true,
      url: targetUrl,
      title: new URL(targetUrl).hostname,
      siteName: "",
      text: plain,
      charCount: plain.length,
      pagesLoaded: 1,
      nextPageUrl: null,
      pageBreaks: []
    };
  }

  const firstPage = extractReadablePageFromHtml(firstFetch.html, targetUrl);
  const startPageNum = getPageNumberFromUrl(new URL(targetUrl));

  const visited = new Set<string>([targetUrl]);
  const pageBodies: { pageNum: number; bodyText: string }[] = [];
  if (firstPage.bodyText) {
    pageBodies.push({ pageNum: startPageNum, bodyText: firstPage.bodyText });
  }

  let pagesLoaded = 1;
  let nextPageUrl = firstPage.nextPageUrl;

  while (nextPageUrl && pagesLoaded < maxPages && !visited.has(nextPageUrl)) {
    visited.add(nextPageUrl);
    try {
      const nextFetch = await fetchHtmlViaCorsProxy(nextPageUrl, options?.signal);
      if (nextFetch.isPlainText) break;
      const nextExtracted = extractReadablePageFromHtml(nextFetch.html, nextPageUrl);
      if (nextExtracted.bodyText) {
        pageBodies.push({
          pageNum: getPageNumberFromUrl(new URL(nextPageUrl)) || startPageNum + pagesLoaded,
          bodyText: nextExtracted.bodyText
        });
        pagesLoaded++;
      }
      nextPageUrl = nextExtracted.nextPageUrl && !visited.has(nextExtracted.nextPageUrl)
        ? nextExtracted.nextPageUrl
        : null;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }
      break;
    }
  }

  const finalLines: string[] = [];
  const pageBreaks: PageBreakMarker[] = [];

  const firstBodyFirstLine = pageBodies[0]?.bodyText.split("\n")[0]?.trim() || "";
  if (
    firstPage.title &&
    (!firstBodyFirstLine || (!firstBodyFirstLine.includes(firstPage.title) && !firstPage.title.includes(firstBodyFirstLine)))
  ) {
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
    throw new Error("本文を抽出できませんでした（JavaScript専用ページまたはログインが必要なページの可能性があります）。");
  }

  return {
    ok: true,
    url: targetUrl,
    title: firstPage.title,
    siteName: firstPage.siteName,
    text: finalText,
    charCount: finalText.length,
    pagesLoaded,
    nextPageUrl,
    pageBreaks: validPageBreaks
  };
}
