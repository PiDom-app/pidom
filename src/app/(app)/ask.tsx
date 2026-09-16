import { AskScreen } from '@/features/intelligence/ask/ask-screen';

export default AskScreen;

/**
 * Asking a model about the document behind it.
 *
 * A route rather than a sheet, which is the line `docs/design.md` draws: its
 * height is the reader's data. Pushed rather than presented, so the document
 * stays mounted underneath and coming back is not reopening a 400-page file —
 * the same reason `navigator` and `bookmark` are pushed.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The boundary
 * is here for the same reason it is on every other authenticated route — a
 * query error is re-thrown during render, and without it a lapsed profile is a
 * blank screen with no way out but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
