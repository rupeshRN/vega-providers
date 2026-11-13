
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

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getCategoryName(filter: string, cardText: string): string {
  if (filter === "/motorsport/") {
    return "Motorsport";
  }

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

    if (!rawHref.includes("/watch/")) {
      return;
    }

    const link = absoluteUrl(rawHref);

    if (!link || seenLinks.has(link)) {
      return;
    }

    seenLinks.add(link);

    // Search upward for the complete event card.
    // Do not stop merely because an image is present.
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

      if (!$parent.length) {
        break;
      }

      $card = $parent;
    }

    if (!foundHeading) {
      $card = $bestCard;
    }

    }

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

    if (!title || title.length < 3) {
      return;
    }

    const category = getCategoryName(filter, cardText);

    const sourceMatch = cardText.match(/(\d+)\s+sources?/i);

    const post: Post = {
      title,
      link,
      image: imageUrl,
      ...(category ? { tag: category } : {}),
      ...(sourceMatch
        ? { cornerTag: `${sourceMatch[1]} sources` }
        : {}),
    };

    posts.push(post);
  });

  return posts;
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

  return parseEvents(html, path, providerContext);
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
  // Rerace's public page pagination route has not been confirmed.
  // Return no extra items instead of repeating page-one events.
  if (page > 1) {
    return [];
  }

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
  if (page > 1 || !searchQuery.trim()) {
    return [];
  }

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
