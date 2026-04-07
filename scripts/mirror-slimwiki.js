const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

const OUTPUT_ROOT = path.resolve(process.cwd(), "output");
const SITE_ROOT = path.join(OUTPUT_ROOT, "site");
const PDF_ROOT = path.join(OUTPUT_ROOT, "pdf");
const ASSET_ROOT = path.join(SITE_ROOT, "__assets__");

const START_URL = process.env.SLIMWIKI_START_URL || "https://slimwiki.com/dark-tower-int/acfu/welcome";
const startUrl = new URL(START_URL);
const pagePrefix = process.env.SLIMWIKI_PAGE_PREFIX || startUrl.pathname.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
const sameOrigins = new Set([
  startUrl.origin,
  "https://api.beta.slimwiki.com",
]);

const assetCache = new Map();
const pageIndex = [];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function safeName(value, fallback = "index") {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function localAssetPathForUrl(urlString) {
  const url = new URL(urlString);
  const hostDir = safeName(url.hostname);
  const pathname = decodeURIComponent(url.pathname);
  const parsed = path.parse(pathname);
  const ext = parsed.ext || ".bin";
  const baseName = safeName(parsed.name || "index");
  const relDir = path.join(
    "__assets__",
    hostDir,
    safeName(parsed.dir.replace(/^\/+/, "") || "root"),
  );
  const suffix = url.search ? `-${hash(url.search)}` : "";
  const relPath = path.join(relDir, `${baseName}${suffix}${ext}`);
  return {
    absolutePath: path.join(SITE_ROOT, relPath),
    relativeFromSiteRoot: `/${relPath.split(path.sep).join("/")}`,
  };
}

function pagePathsForUrl(urlString) {
  const url = new URL(urlString);
  const cleanPath = url.pathname.replace(/\/+$/, "");
  const segments = cleanPath.split("/").filter(Boolean).map((part) => safeName(part));
  const pageDir = path.join(SITE_ROOT, ...segments);
  const pdfPath = path.join(PDF_ROOT, ...segments) + ".pdf";
  return {
    pageDir,
    htmlPath: path.join(pageDir, "index.html"),
    pdfPath,
    publicPath: `/${segments.join("/")}/`,
  };
}

function normalizePageUrl(urlString) {
  const url = new URL(urlString);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function shouldMirrorPage(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }

  if (url.origin !== startUrl.origin) {
    return false;
  }

  if (!url.pathname.startsWith(pagePrefix)) {
    return false;
  }

  return true;
}

function isDataUrl(value) {
  return value.startsWith("data:");
}

async function fetchBuffer(urlString) {
  const response = await fetch(urlString, {
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function rewriteCssUrls(cssText, baseUrl, owningFilePath) {
  const matches = [...cssText.matchAll(/url\((['"]?)([^"')]+)\1\)/g)];
  let updated = cssText;

  for (const match of matches) {
    const original = match[2].trim();
    if (!original || isDataUrl(original) || original.startsWith("#")) {
      continue;
    }

    const resolvedUrl = new URL(original, baseUrl).toString();
    const localUrl = await downloadAsset(resolvedUrl, owningFilePath);
    updated = updated.replace(match[0], `url("${localUrl}")`);
  }

  return updated;
}

async function downloadAsset(urlString, ownerPath) {
  const normalizedUrl = new URL(urlString).toString();

  if (assetCache.has(normalizedUrl)) {
    const existing = assetCache.get(normalizedUrl);
    return path.posix.relative(path.posix.dirname(ownerPath), existing.publicPath);
  }

  const target = localAssetPathForUrl(normalizedUrl);
  const publicPath = target.relativeFromSiteRoot;
  assetCache.set(normalizedUrl, { publicPath });

  await ensureDir(path.dirname(target.absolutePath));
  const buffer = await fetchBuffer(normalizedUrl);

  const ext = path.extname(target.absolutePath).toLowerCase();
  if (ext === ".css") {
    const cssText = await rewriteCssUrls(buffer.toString("utf8"), normalizedUrl, publicPath);
    await fs.writeFile(target.absolutePath, cssText, "utf8");
  } else {
    await fs.writeFile(target.absolutePath, buffer);
  }

  return path.posix.relative(path.posix.dirname(ownerPath), publicPath);
}

function replaceAttr(html, attrName, value, nextValue) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrPattern = new RegExp(`(${attrName}\\s*=\\s*["'])${escaped}(["'])`, "g");
  return html.replace(attrPattern, `$1${nextValue}$2`);
}

function rewriteSrcsetValue(srcsetValue, replacer) {
  return srcsetValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split(/\s+/);
      const rewritten = replacer(parts[0]);
      return [rewritten, ...parts.slice(1)].join(" ");
    })
    .join(", ");
}

async function savePageHtml({ pageUrl, html, htmlPublicPath }) {
  let updated = html;
  const pageDir = path.posix.dirname(htmlPublicPath);

  const resourceRegex = /<(img|source|video|audio|script|iframe|link)\b[^>]*?\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  const resources = [...updated.matchAll(resourceRegex)];
  for (const match of resources) {
    const attr = match[2];
    const value = match[3];
    if (!value || isDataUrl(value) || value.startsWith("blob:") || value.startsWith("mailto:") || value.startsWith("tel:")) {
      continue;
    }

    const absolute = new URL(value, pageUrl).toString();
    const assetUrl = await downloadAsset(absolute, htmlPublicPath);
    updated = replaceAttr(updated, attr, value, assetUrl);
  }

  const srcsetRegex = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  const srcsetMatches = [...updated.matchAll(srcsetRegex)];
  for (const match of srcsetMatches) {
    const rewritten = rewriteSrcsetValue(match[1], (item) => {
      const absolute = new URL(item, pageUrl).toString();
      return path.posix.relative(pageDir, localAssetPathForUrl(absolute).relativeFromSiteRoot);
    });

    const originalAttr = match[0];
    const nextAttr = `srcset="${rewritten}"`;
    updated = updated.replace(originalAttr, nextAttr);

    for (const item of match[1].split(",").map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean)) {
      const absolute = new URL(item, pageUrl).toString();
      await downloadAsset(absolute, htmlPublicPath);
    }
  }

  const hrefRegex = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
  const hrefMatches = [...updated.matchAll(hrefRegex)];
  for (const match of hrefMatches) {
    const value = match[1];
    if (!value || value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:")) {
      continue;
    }

    const absolute = new URL(value, pageUrl);
    if (shouldMirrorPage(absolute.toString())) {
      const targetPaths = pagePathsForUrl(absolute.toString());
      const localHref = path.posix.relative(pageDir, targetPaths.publicPath) + absolute.hash;
      updated = replaceAttr(updated, "href", value, localHref || ".");
    }
  }

  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const styleMatches = [...updated.matchAll(styleRegex)];
  for (const match of styleMatches) {
    const rewrittenCss = await rewriteCssUrls(match[1], pageUrl, htmlPublicPath);
    updated = updated.replace(match[0], `<style>${rewrittenCss}</style>`);
  }

  updated = updated.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  updated = updated.replace("</head>", '<meta name="generator" content="SlimWiki local mirror"></head>');

  return updated;
}

async function buildIndexPage() {
  const sorted = [...pageIndex].sort((a, b) => a.title.localeCompare(b.title));
  const items = sorted
    .map(
      (item) =>
        `<li><a href="${item.publicPath}">${item.title}</a> <small><a href="${item.pdfPath}">PDF</a></small></li>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SlimWiki Local Mirror</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 40px auto; max-width: 960px; padding: 0 20px; line-height: 1.5; }
    h1 { margin-bottom: 8px; }
    ul { padding-left: 20px; }
    li { margin: 8px 0; }
    small { margin-left: 8px; }
  </style>
</head>
<body>
  <h1>SlimWiki Local Mirror</h1>
  <p>Source: <a href="${START_URL}">${START_URL}</a></p>
  <p>Pages mirrored: ${sorted.length}</p>
  <ul>${items}</ul>
</body>
</html>`;

  await fs.writeFile(path.join(SITE_ROOT, "index.html"), html, "utf8");
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = 800;
      const timer = setInterval(() => {
        const height = document.documentElement.scrollHeight;
        window.scrollTo(0, y);
        y += step;
        if (y >= height) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });
}

async function mirror() {
  await ensureDir(SITE_ROOT);
  await ensureDir(PDF_ROOT);

  const browser = await chromium.launch({ headless: true });
  const queue = [normalizePageUrl(START_URL)];
  const visited = new Set();

  try {
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);

      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
      console.log(`Mirroring ${current}`);

      await page.goto(current, { waitUntil: "networkidle", timeout: 120000 });
      await autoScroll(page);
      await page.waitForTimeout(1200);

      const extracted = await page.evaluate(() => ({
        title: document.title,
        html: document.documentElement.outerHTML,
        links: Array.from(document.querySelectorAll("a[href]")).map((a) => a.href),
      }));

      const pagePaths = pagePathsForUrl(current);
      await ensureDir(pagePaths.pageDir);
      await ensureDir(path.dirname(pagePaths.pdfPath));

      const finalizedHtml = await savePageHtml({
        pageUrl: current,
        html: extracted.html,
        htmlPublicPath: pagePaths.publicPath + "index.html",
      });

      await fs.writeFile(pagePaths.htmlPath, finalizedHtml, "utf8");
      await page.pdf({
        path: pagePaths.pdfPath,
        printBackground: true,
        preferCSSPageSize: true,
        format: "A4",
        margin: {
          top: "12mm",
          right: "12mm",
          bottom: "12mm",
          left: "12mm",
        },
      });

      pageIndex.push({
        title: extracted.title.replace(/\s+-\s+SlimWiki$/, ""),
        publicPath: pagePaths.publicPath,
        pdfPath: path.posix.relative("/", pagePaths.pdfPath.replace(PDF_ROOT, "/pdf").split(path.sep).join("/")),
      });

      for (const href of extracted.links) {
        if (shouldMirrorPage(href)) {
          const normalized = normalizePageUrl(href);
          if (!visited.has(normalized)) {
            queue.push(normalized);
          }
        }
      }

      await page.close();
    }

    await buildIndexPage();
  } finally {
    await browser.close();
  }

  console.log(`Mirrored ${pageIndex.length} pages into ${OUTPUT_ROOT}`);
}

mirror().catch((error) => {
  console.error(error);
  process.exit(1);
});
