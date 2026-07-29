import type {
  DownloadCounts,
  DownloadFilter,
  DownloadItem,
} from "./types";
import { isActiveDownload } from "./utils";

export function getDownloadCounts(downloads: DownloadItem[]): DownloadCounts {
  return downloads.reduce<DownloadCounts>(
    (counts, item) => {
      counts.all += 1;
      counts[item.type] += 1;

      if (isActiveDownload(item.status)) counts.active += 1;
      if (item.status === "completed") counts.completed += 1;

      return counts;
    },
    { all: 0, active: 0, completed: 0, audio: 0, video: 0 },
  );
}

export function filterDownloads(
  downloads: DownloadItem[],
  filter: DownloadFilter,
  search: string,
  language: string,
): DownloadItem[] {
  const query = search.trim().toLocaleLowerCase(language);

  return downloads.filter((item) => {
    const categoryMatch =
      filter === "all" ||
      (filter === "active" && isActiveDownload(item.status)) ||
      (filter === "completed" && item.status === "completed") ||
      item.type === filter;

    return (
      categoryMatch &&
      (!query ||
        item.name.toLocaleLowerCase(language).includes(query) ||
        item.url.includes(query))
    );
  });
}
