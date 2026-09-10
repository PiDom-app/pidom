import React, { useState } from 'react';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';

import { GoogleIcon } from './google-icon';

/**
 * The single action on the sign-in screen.
 *
 * Holds its own pending state rather than taking one as a prop: the gap between
 * the tap and the native sheet appearing is where a second tap would land, and
 * the library rejects a concurrent call. Disabling on press closes that window
 * at the only place that knows about it.
 */
export function GoogleSignInButton({ onPress }: { onPress: () => Promise<void> }) {
  const [pending, setPending] = useState(false);

  async function handlePress() {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await onPress();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="lg"
      variant="outline"
      // `h-14` is the whole geometry; the base already supplies
      // `flex-row items-center justify-center gap-2`, which is where the 8px
      // between the mark and the label comes from.
      className="h-14 self-center"
      isDisabled={pending}
      onPress={handlePress}
      // Tracks the label, so a screen reader is not told "Continue with Google"
      // while the button reads "Signing in".
      accessibilityLabel={pending ? 'Signing in with Google' : 'Continue with Google'}>
      {pending ? <ButtonSpinner className="text-foreground" /> : <GoogleIcon size={18} />}
      <ButtonText className="text-base font-medium text-foreground">
        {pending ? 'Signing in' : 'Continue with Google'}
      </ButtonText>
    </Button>
  );
}
