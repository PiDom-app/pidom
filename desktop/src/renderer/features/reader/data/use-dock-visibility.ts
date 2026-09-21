import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolbarBehavior } from '@/features/settings/use-desktop-settings';

/**
 * Whether the floating dock is shown, per the account's Toolbar behaviour.
 *
 * `always` keeps it up. `manual` shows it only when the reader asks (a shortcut
 * or the peek handle) and hides it again on the next request. `auto-hide` is the
 * reading default: the dock retreats after a few idle seconds and returns the
 * moment the pointer nears the bottom edge or any dock-driving action fires, so
 * the page keeps the full height while the controls stay one gesture away.
 */

const IDLE_MS = 2600;
/** How close to the bottom edge (px) wakes an auto-hidden dock. */
const WAKE_ZONE = 88;

export interface DockVisibility {
  visible: boolean;
  /** Bind to the reader surface; drives the auto-hide wake/idle timer. */
  onPointerMove: (event: React.PointerEvent) => void;
  /** Call when an action should reveal the dock (shortcut, jump, mode change). */
  wake: () => void;
  /** Manual mode's explicit toggle, bound to the peek handle and the `T` key. */
  toggle: () => void;
}

export function useDockVisibility(behavior: ToolbarBehavior): DockVisibility {
  const [visible, setVisible] = useState(behavior !== 'manual');
  const idleTimer = useRef<number | null>(null);

  const clearIdle = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const armIdle = useCallback(() => {
    clearIdle();
    idleTimer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
  }, [clearIdle]);

  // Reset to the mode's resting state whenever the setting changes.
  useEffect(() => {
    clearIdle();
    if (behavior === 'always') {
      setVisible(true);
    } else if (behavior === 'manual') {
      setVisible(false);
    } else {
      setVisible(true);
      armIdle();
    }
    return clearIdle;
  }, [behavior, armIdle, clearIdle]);

  const wake = useCallback(() => {
    if (behavior === 'manual') return;
    setVisible(true);
    if (behavior === 'auto-hide') armIdle();
  }, [behavior, armIdle]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (behavior !== 'auto-hide') return;
      const nearBottom =
        event.currentTarget.getBoundingClientRect().bottom - event.clientY <= WAKE_ZONE;
      if (nearBottom) {
        setVisible(true);
        armIdle();
      }
    },
    [behavior, armIdle],
  );

  const toggle = useCallback(() => setVisible((v) => !v), []);

  return { visible, onPointerMove, wake, toggle };
}
