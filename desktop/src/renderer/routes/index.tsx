import { createFileRoute } from '@tanstack/react-router';
import { ConnectionScreen } from '../features/auth/components/connection-screen';

/**
 * The first-run route: connect this desktop app to the reader's existing Pidom
 * account. This is the whole desktop experience today — the library and reader
 * screens are separate future work.
 */
export const Route = createFileRoute('/')({
  component: ConnectionScreen,
});
