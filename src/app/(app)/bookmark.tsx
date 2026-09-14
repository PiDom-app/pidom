import { BookmarkNameScreen } from '@/features/reader/bookmark-name-screen';

export default BookmarkNameScreen;

/**
 * Giving a marked page a name.
 *
 * Routes hold no logic; the screen is composed in `src/features`. This replaced
 * `/note`, which did this job alongside writing notes — a feature this app no
 * longer has.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
