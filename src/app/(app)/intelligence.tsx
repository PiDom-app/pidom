import { IntelligenceScreen } from '@/features/intelligence/intelligence-screen';

export default IntelligenceScreen;

/**
 * How this device finds what a document means, and what Ask may send.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The boundary
 * is here for the same reason it is on every other authenticated route — a
 * query error is re-thrown during render, and without it a lapsed profile is a
 * blank screen with no way out but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
