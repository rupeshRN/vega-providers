
import { Post, ProviderContext } from "../types";

const BASE_URL = "https://www.rerace.net";

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

    // The live feed includes upcoming events; only list events that are live.
    if (filter === "/live/" && !/\bLIVE\b/i.test(cardText)) return;

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
async function fetchRenderedMobilePage(
  url: string,
  providerContext: ProviderContext,
): Promise<string> {
  const result = await providerContext.openWebView(url, {
    title: "Refresh live RERACE events",
    description: "Loading the live event list from RERACE.",
    force: true,
    timeoutMs: 45000,
    headers: {
      ...providerContext.commonHeaders,
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    },
    injectedJavaScript: `
      (function () {
        setTimeout(function () {
          if (!window.ReactNativeWebView || !document.documentElement) return;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            __waf: true,
            data: document.documentElement.outerHTML
          }));
        }, 8000);
      })();
      true;
    `,
  });

  const rawData =
    typeof result.data === "string"
      ? result.data
      : String(result.data ?? "");

  try {
    const envelope = JSON.parse(rawData);
    if (typeof envelope.data === "string") return envelope.data;
  } catch {}

  return rawData;
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

  // The HTTP response can contain an older desktop rendering while the mobile
  // page has the current live list. Use the rendered mobile DOM when the live
  // section is present but its active event cards are missing from the response.
  if (
    path === "/live/" &&
    posts.length === 0 &&
    /live matches|live now/i.test(html)
  ) {
    try {
      const mobileHtml = await fetchRenderedMobilePage(baseUrl, providerContext);
      const mobilePosts = parseEvents(mobileHtml, path, providerContext);
      if (mobilePosts.length > 0) return mobilePosts;
    } catch {
      // Keep the provider usable when the interactive WebView is unavailable.
    }
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
