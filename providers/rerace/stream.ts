
import { Stream, ProviderContext } from "../types";

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  /*
   * Rerace event links are webpages, not direct video streams.
   *
   * Playback is handled by the event page through Info.webUrl
   * and Vega's in-app WebView.
   *
   * Do not return the event URL as an m3u8, mp4, or other
   * native stream. Only add native streams if a legitimate,
   * directly playable media URL is independently available.
   */

  return [];

};
