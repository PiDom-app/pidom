import { useCallback, useMemo, useState } from 'react';
import type { Id } from '@convex/dataModel';

export type DocumentId = Id<'documents'>;

/**
 * The library's multi-select model, owned once above both views so a selection
 * survives the grid⇄list toggle. State is a `Record<id, true>` keyed by the
 * stable `doc.id` (never a row index), so a document stays selected as pages
 * load, the view switches, or the list re-sorts.
 *
 * The anchor is the last row the reader touched with a plain toggle; a
 * subsequent Shift-click fills the range between it and the new row against the
 * caller's *ordered* ids (the on-screen order after filter and sort), the same
 * range semantics a file manager has. Range logic runs against ids the caller
 * passes rather than any internal order, so it is correct in whichever view is
 * showing.
 */
export interface Selection {
  /** Whether anything is selected — the flag that flips the header into the toolbar. */
  active: boolean;
  count: number;
  ids: DocumentId[];
  isSelected: (id: DocumentId) => boolean;
  /** Toggle one id and move the range anchor to it. */
  toggle: (id: DocumentId) => void;
  /** Collapse the selection to just this id (a plain click in selection mode). */
  selectOnly: (id: DocumentId) => void;
  /** Fill the range from the anchor to `id` against the on-screen order. */
  toggleRange: (id: DocumentId, orderedIds: DocumentId[]) => void;
  /** Set a whole set at once — the list's select-all / clear-all header box. */
  setMany: (targetIds: DocumentId[], value: boolean) => void;
  clear: () => void;
}

export function useSelection(): Selection {
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [anchor, setAnchor] = useState<DocumentId | null>(null);

  const ids = useMemo(() => Object.keys(selected) as DocumentId[], [selected]);
  const count = ids.length;

  const isSelected = useCallback((id: DocumentId) => selected[id] === true, [selected]);

  const toggle = useCallback((id: DocumentId) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
    setAnchor(id);
  }, []);

  const selectOnly = useCallback((id: DocumentId) => {
    setSelected({ [id]: true });
    setAnchor(id);
  }, []);

  const toggleRange = useCallback(
    (id: DocumentId, orderedIds: DocumentId[]) => {
      const from = anchor ?? id;
      const start = orderedIds.indexOf(from);
      const end = orderedIds.indexOf(id);
      // Anchor scrolled out of the loaded window, or an id not in view: fall
      // back to a plain toggle rather than selecting an unknowable range.
      if (start === -1 || end === -1) {
        toggle(id);
        return;
      }
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      setSelected((prev) => {
        const next = { ...prev };
        for (let i = lo; i <= hi; i += 1) next[orderedIds[i]] = true;
        return next;
      });
      // Anchor stays put so a further Shift-click extends from the same origin.
    },
    [anchor, toggle],
  );

  const setMany = useCallback((targetIds: DocumentId[], value: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const id of targetIds) {
        if (value) next[id] = true;
        else delete next[id];
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected({});
    setAnchor(null);
  }, []);

  return {
    active: count > 0,
    count,
    ids,
    isSelected,
    toggle,
    selectOnly,
    toggleRange,
    setMany,
    clear,
  };
}

/**
 * Shared click semantics for a tile or a row, so the grid and the list behave
 * identically. Shift extends a range from the anchor, Cmd/Ctrl toggles one, and
 * a plain click toggles only while a selection is already live (so ordinary
 * browsing is untouched until the reader opts into selection via a checkbox or
 * a modifier). Returns whether the click was consumed by selection; a `false`
 * leaves the caller free to do its own thing with a plain click.
 */
export function handleSelectionClick(
  selection: Selection,
  orderedIds: DocumentId[],
  id: DocumentId,
  e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
): boolean {
  if (e.shiftKey) {
    selection.toggleRange(id, orderedIds);
    return true;
  }
  if (e.metaKey || e.ctrlKey) {
    selection.toggle(id);
    return true;
  }
  if (selection.active) {
    selection.toggle(id);
    return true;
  }
  return false;
}
