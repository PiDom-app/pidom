import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy, RefreshCw, RotateCcw } from 'lucide-react';
import { buttonGhostClass, buttonPrimaryClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The last line of defence for a render crash.
 *
 * The renderer has no chrome of its own — a thrown error unmounts the whole tree
 * and leaves the window on the black page background, which reads as "the app
 * died". This catches that and shows a calm, recoverable screen instead: retry
 * without a full reload, reload the window, or copy the technical details for a
 * bug report. The stack is logged so DevTools keeps the full trace.
 */
interface State {
  error: Error | null;
  componentStack: string;
  showDetails: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: '', showDetails: false, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface it; DevTools keeps the full stack. Never swallow silently.
    console.error('Renderer crash caught by ErrorBoundary:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private reset = () =>
    this.setState({ error: null, componentStack: '', showDetails: false, copied: false });

  private reload = () => window.location.reload();

  private details(): string {
    const { error, componentStack } = this.state;
    return [
      `Pidom Desktop — error report`,
      `When: ${new Date().toISOString()}`,
      ``,
      `${error?.name ?? 'Error'}: ${error?.message ?? 'Unknown error'}`,
      ``,
      error?.stack ?? '(no stack)',
      componentStack ? `\nComponent stack:${componentStack}` : '',
    ].join('\n');
  }

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(this.details());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* clipboard can be unavailable; the details are still on screen */
    }
  };

  render(): ReactNode {
    const { error, componentStack, showDetails, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <div className="w-full max-w-lg">
          <div className="flex size-12 items-center justify-center rounded-full bg-danger-tint">
            <AlertTriangle className="size-6 text-destructive" />
          </div>

          <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            This screen hit an unexpected error and stopped. Your library and documents are safe —
            nothing was lost. Try again, or reload the window if it keeps happening.
          </p>

          <p className="mt-4 rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground">
            {error.message || 'Unknown error'}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button className={buttonPrimaryClass} onClick={this.reset}>
              <RotateCcw className="size-4" />
              Try again
            </button>
            <button className={buttonGhostClass} onClick={this.reload}>
              <RefreshCw className="size-4" />
              Reload window
            </button>
            <button className={buttonGhostClass} onClick={() => void this.copy()}>
              {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </div>

          <button
            onClick={() => this.setState({ showDetails: !showDetails })}
            aria-expanded={showDetails}
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-fg-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', showDetails && 'rotate-180')}
            />
            Technical details
          </button>

          {showDetails && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-sunken p-3 text-xs leading-relaxed whitespace-pre-wrap text-fg-muted">
              {`${error.stack ?? error.message}${
                componentStack ? `\n\nComponent stack:${componentStack}` : ''
              }`}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
