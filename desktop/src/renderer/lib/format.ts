import { formatDistanceToNowStrict } from 'date-fns';

/** Human file size from a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** "3 days ago" for a timestamp, or null when there is none. */
export function formatRelative(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  return `${formatDistanceToNowStrict(timestamp)} ago`;
}

/** Progress as a whole percentage. */
export function formatProgress(progress: number): string {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

/** "p. 12 of 340" when both are known, "p. 12" when the total is not. */
export function formatPage(currentPage: number, pageCount: number | null): string {
  return pageCount ? `p. ${currentPage} of ${pageCount}` : `p. ${currentPage}`;
}
