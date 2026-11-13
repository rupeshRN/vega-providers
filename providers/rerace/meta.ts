
import { Info, ProviderContext } from "../types";

const BASE_URL = "https://www.rerace.net";

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

function getMetaContent(
  $: ReturnType<ProviderContext["cheerio"]["load"]>,
  selectors: string[],
): string {
  for (const selector of selectors) {
    const value = $(selector).attr("content");

    if (value && value.trim()) {
      return cleanText(value);
    }
  }

  return "";
}

function getEventCategory(link: string): string {
  const match = link.match(/[?&]s=([^&]+)/i);

  if (!match) return "Live Sports";

  const category = match[1]
    .replace(/\+/g, " ")
    .replace(/-/g, " ");

  return category.replace(/\b\w/g, (letter) =>
    letter.toUpperCase(),
  );
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const eventUrl = absoluteUrl(link);

  const response = await providerContext.axios.get(eventUrl, {
    headers: providerContext.commonHeaders,
  });

  const html =
    typeof response.data === "string"
      ? response.data
      : String(response.data ?? "");

  const $ = providerContext.cheerio.load(html);

  const title =
    getMetaContent($, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text()) ||
    "Live Sports Event";

  const synopsis =
    getMetaContent($, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]) ||
    "Open this event to view the available streaming sources.";

  const rawImage = getMetaContent($, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);

  const image = absoluteUrl(rawImage);

  const category = getEventCategory(eventUrl);

  return {
    title,
    image,
    synopsis,
    imdbId: "",
    type: "movie",
    tags: [category, "Live Event"],
    linkList: [],
    webUrl: eventUrl,
  };
};
