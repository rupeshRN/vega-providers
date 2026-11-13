
import { Post, ProviderContext } from "../types";

const BASE_URL = "https://www.rerace.net";
const WEBVIEW_TEST_KEY = "rerace_live_webview_diagnostic_v1";

const CATEGORY_NAMES: Record<string, string> = {
  football: "Football",
  basketball: "Basketball",
  "american-football": "American Football",
  hockey: "Hockey",
  baseball: "Baseball",
  tennis: "Tennis",
  fight: "Fight",
  rugby: "Rugby",
  golf: "Golf",
  cricket: "Cricket",
  darts: "Darts",
  billiards: "Billiards",
  afl: "AFL",
  other: "Other Sports",
};

function absoluteUrl(value: string): string {
  const url = value.trim();

  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;

  return `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getCategoryName(filter: string, cardText: string): string {
  if (filter === "/motorsport/") return "Motorsport";

  const match = filter.match(/^\/sports\/([^/]+)\//);

  if (match && CATEGORY_NAMES[match[1]]) {
    return CATEGORY_NAMES[match[1]];
  }

  const categories = [
    "American Football",
    "Basketball",
    "Football",
    "Hockey",
    "Baseball",
    "Motorsport",
    "Fight",
    "Tennis",
    "Rugby",
    "Golf",
    "Cricket",
    "Darts",
    "Billiards",
    "AFL",
  ];

  const lowerText = cardText.toLowerCase();

  return (
    categories.find((category) =>
      lowerText.includes(category.toLowerCase()),
    ) || ""
  );
}

function parseEvents(
  html: string,
  filter: string,
  providerContext: ProviderContext,
): Post[] {
  const $ = providerContext.cheerio.load(html);
  const posts: Post[] = [];
  const seenLinks = new Set<string>();

  $('a[href*="/watch/"]').each((_, element) => {
    const $anchor = $(element);
    const rawHref = $anchor.attr("href") || "";

    if (!rawHref.includes("/watch/")) return;

    const link = absoluteUrl(rawHref);

    if (!link || seenLinks.has(link)) return;
    seenLinks.add(link);

    let $card = $anchor;
    let $bestCard = $anchor;
    let bestTextLength = cleanText($anchor.text()).length;
    let foundHeading = false;

    for (let depth = 0; depth < 10; depth++) {
      const heading = cleanText(
        $card.find("h1, h2, h3, h4, h5").first().text(),
      );

      const cardText = cleanText($card.text());

      if (cardText.length > bestTextLength && cardText.length < 500) {
        $bestCard = $card;
        bestTextLength = cardText.length;
      }

      if (heading) {
        foundHeading = true;
        break;
      }

      const $parent = $card.parent();

      if (!$parent.length) break;
      $card = $parent;
    }

    if (!foundHeading) $card = $bestCard;

    const $image = $card.find("img").first();

    const imageValue =
      $image.attr("data-src") ||
      $image.attr("data-lazy-src") ||
      $image.attr("src") ||
      "";

    const srcSet = $image.attr("srcset") || "";

    const firstSrcSetImage = srcSet
      ? srcSet.split(",")[0].trim().split(/\s+/)[0]
      : "";

    const imageUrl = absoluteUrl(imageValue || firstSrcSetImage);

    const heading = cleanText(
      $card.find("h1, h2, h3, h4, h5").first().text(),
    );

    const cardText = cleanText($card.text());

    const title =
      heading ||
      cleanText($anchor.attr("aria-label") || "") ||
      cleanText($anchor.attr("title") || "") ||
      cleanText($image.attr("alt") || "") ||
      cleanText($anchor.text()) ||
      cardText;

    if (!title || title.length < 3) return;

    const category = getCategoryName(filter, cardText);
    const sourceMatch = cardText.match(/(\d+)\s+sources?/i);

    posts.push({
      title,
      link,
      image: imageUrl,
      ...(category ? { tag: category } : {}),
      ...(sourceMatch
        ? { cornerTag: `${sourceMatch[1]} sources` }
        : {}),
    });
  });

  return posts;
}
async function runWebViewDiagnostic(
  url: string,
  providerContext: ProviderContext,
): Promise<string> {
  try {
    const previousResult = await providerContext.kvStore.get<string>(
      "rerace_live_webview_diagnostic_v2",
    );

    if (previousResult) return previousResult;

    const result = await providerContext.openWebView(url, {
      title: "RERACE page network diagnostic",
      description: "Allow the page to load while its requests are inspected.",
      force: true,
      timeoutMs: 60000,
      headers: {
        ...providerContext.commonHeaders,
      },
      injectedJavaScript: `
        (function () {
          setTimeout(function () {
            var resources = performance.getEntriesByType("resource")
              .map(function (entry) { return entry.name; })
              .filter(function (name) {
                return /rerace|api|ajax|json|graphql|event|live|match/i.test(name);
              });

            var scripts = Array.from(document.scripts)
              .map(function (script) { return script.src; })
              .filter(Boolean);

            var bodyText = document.body
              ? document.body.innerText
              : "";

            var report = {
              url: location.href,
              title: document.title,
              liveHeading: /Live matches/i.test(bodyText),
              nigeria: /Nigeria\\\\s*vs\\\\.?\\\\s*Tanzania/i.test(bodyText),
              bodySample: bodyText.slice(0, 2500),
              resources: resources.slice(0, 35),
              scripts: scripts.slice(0, 20)
            };

            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(
                JSON.stringify({
                  __waf: true,
                  data: JSON.stringify(report)
                })
              );
            }
          }, 10000);
        })();
        true;
      `,
    });

    const rawData =
      typeof result.data === "string"
        ? result.data
        : String(result.data ?? "");

    let reportText = rawData;

    try {
      const outer = JSON.parse(rawData);
      if (outer.data) reportText = String(outer.data);
    } catch {}

    let report: any = null;

    try {
      report = JSON.parse(reportText);
    } catch {}

    let diagnostic: string;

    if (report) {
      const candidates = [
        ...(report.resources || []),
        ...(report.scripts || []),
      ];

      diagnostic = [
        `WV2-LIVE:${report.liveHeading}`,
        `WV2-NIGERIA:${report.nigeria}`,
        `WV2-RESOURCES:${(report.resources || []).length}`,
        `WV2-SCRIPTS:${(report.scripts || []).length}`,
        `WV2-DATA:${candidates.join(" ; ").slice(0, 900)}`,
      ].join(" | ");
    } else {
      diagnostic = `WV2-RAW:${rawData.slice(0, 900)}`;
    }

    await providerContext.kvStore.set(
      "rerace_live_webview_diagnostic_v2",
      diagnostic,
    );

    return diagnostic;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    return `WV2-ERROR:${cleanText(message).slice(0, 150)}`;
  }
}

async function fetchEventPosts(
  path: string,
  signal: AbortSignal,
  providerContext: ProviderContext,
): Promise<Post[]> {
  const baseUrl = absoluteUrl(path);
  const separator = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${separator}_rerace_refresh=${Date.now()}`;

  const response = await providerContext.axios.get(url, {
    headers: {
      ...providerContext.commonHeaders,
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
    signal,
  });

  const html =
    typeof response.data === "string"
      ? response.data
      : String(response.data ?? "");

  const posts = parseEvents(html, path, providerContext);

  if (path === "/live/" && posts.length > 0) {
    const diagnostic = await runWebViewDiagnostic(
      baseUrl,
      providerContext,
    );

    posts[0].cornerTag = diagnostic;
  }

  return posts;
}

export const getPosts = async function ({
  filter,
  page,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  if (page > 1) return [];

  return fetchEventPosts(
    filter || "/",
    signal,
    providerContext,
  );
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  if (page > 1 || !searchQuery.trim()) return [];

  const posts = await fetchEventPosts(
    "/",
    signal,
    providerContext,
  );

  const query = searchQuery.trim().toLowerCase();

  return posts.filter((post) =>
    post.title.toLowerCase().includes(query),
  );
};
