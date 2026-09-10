import React, { useCallback } from 'react';

import { Toast, ToastDescription, ToastTitle, useToast } from '@/components/ui/toast';

export type ToastTone = 'error' | 'success' | 'info';

export type AppToastOptions = {
  /** Stable per message kind, so repeats replace rather than stack. */
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
};

/**
 * One place that decides what a transient message looks like.
 *
 * Calling `useToast` at each site means every screen re-decides placement,
 * duration, and whether repeats stack — and they drift apart. This fixes all
 * three.
 *
 * Toasts are for things the reader need not act on: a cancelled sign-in, a
 * dropped connection, a saved change. Anything requiring an acknowledgement, or
 * with a consequence, belongs in a confirmation sheet.
 */
export function useAppToast() {
  const toast = useToast();

  return useCallback(
    ({ id, title, description, tone = 'info' }: AppToastOptions) => {
      // Tapping a failing action three times should leave one message on
      // screen, not three identical ones.
      if (toast.isActive(id)) {
        toast.close(id);
      }

      toast.show({
        id,
        placement: 'top',
        duration: 4000,
        render: () => (
          <Toast action={tone} variant="outline">
            {/* All three actions render the same popover surface, so the tone
                has to come through the title colour. */}
            <ToastTitle
              className={tone === 'error' ? 'text-destructive' : 'text-foreground'}>
              {title}
            </ToastTitle>
            {description === undefined ? null : (
              <ToastDescription className="text-muted-foreground">
                {description}
              </ToastDescription>
            )}
          </Toast>
        ),
      });
    },
    [toast],
  );
}
