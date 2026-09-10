import React from 'react';
import { View } from 'react-native';
import Pdf from 'react-native-pdf';

import { themeColors, type ThemeName } from '@/design/tokens';

/**
 * One page of the document, small, and only for as long as it is looked at.
 *
 * The scrubber mounts this while a finger is down and unmounts it on release.
 * That scoping is the whole design: a preview is a second native document
 * handle over the same file, which is fine for the second or two of a drag and
 * is not something to leave running.
 *
 * `singlePage` rather than `scrollEnabled={false}` — it is the package's own
 * primitive for "one page, no scrolling", and it does not swallow gestures the
 * way faking it does.
 *
 * Every safety prop the main canvas sets is set here too. A second `<Pdf>` that
 * quietly kept `trustAllCerts` at its `true` default would undo the guarantee
 * the first one makes.
 */
export function PagePreview({
  uri,
  page,
  password,
  theme,
  width,
  height,
}: {
  uri: string;
  page: number;
  password?: string;
  theme: ThemeName;
  width: number;
  height: number;
}) {
  const style = { flex: 1, backgroundColor: themeColors[theme].background } as const;
  return (
    <View
      style={{ width, height, overflow: 'hidden', borderRadius: 6 }}
      // Decorative: the page number and chapter beside it carry the meaning,
      // and a screen reader has no use for a picture of a page.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Pdf
        source={{ uri }}
        page={page}
        password={password}
        singlePage
        fitPolicy={2}
        spacing={0}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        trustAllCerts={false}
        enableAnnotationRendering={false}
        enableTextSelection={false}
        enableDoubleTapZoom={false}
        renderActivityIndicator={() => <View />}
        // A thumbnail that cannot render is a blank rectangle for a moment.
        // Nothing here is worth reporting, and certainly not worth condemning
        // the document the reader is in the middle of.
        onError={() => {}}
        style={style}
      />
    </View>
  );
}
