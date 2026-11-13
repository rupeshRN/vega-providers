
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

    // Move up through the event card to find its title and image.
    let $card = $anchor;

    for (let depth = 0; depth < 6; depth++) {
      const heading = cleanText(
        $card.find("h1, h2, h3, h4, h5").first().text(),
      );

      const cardText = cleanText($card.text());

      const image =
        $card.find("img").first().attr("data-src") ||
        $card.find("img").first().attr("data-lazy-src") ||
        $card.find("img").first().attr("src");

      if (heading || image || cardText.length > 250) {
        break;
      }

      const $parent = $card.parent();

      if (!$parent.length) {
        break;
      }

      $card = $parent;
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
  const url = absoluteUrl(path);

  const response = await providerContext.axios.get(url, {
    headers: providerContext.commonHeaders,
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

  // Rerace's own search endpoint has not been confirmed.
  // Search the event listings currently visible on its homepage.
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
