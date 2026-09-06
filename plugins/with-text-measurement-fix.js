const { withMainActivity } = require('expo/config-plugins');

/**
 * Stops Android's "Bold text" accessibility setting from cutting the end off
 * every line of text in the app.
 *
 * Android 12 added `Configuration.fontWeightAdjustment`, which Settings →
 * Accessibility → Display size and text → Bold text sets to 300. The system
 * adds that to every font weight at *render* time. React Native measures text
 * with the unadjusted typeface, so every string is laid out narrower than it
 * draws, and the overflow is clipped — silently, with no ellipsis.
 *
 * It is not subtle. With the setting on, this app rendered "Sign out" as
 * "Sign", an email address without its `.com`, and "Contents" as "Content".
 * It is an old React Native bug, not a bug in this app:
 * https://github.com/react/react-native/issues/21729
 *
 * **The trade-off is real and worth stating.** Neutralising the adjustment
 * means somebody who turned Bold text on will not get bolder text in Pidom.
 * The alternative is honouring the preference and losing the last word of
 * every label, which is worse for exactly the people the setting exists for —
 * a reader who cannot read thin text also cannot read a sentence missing its
 * end. The app's own weights (`font-semibold`, `font-bold`) are unaffected;
 * only the system-wide bump is dropped.
 *
 * To go back to the system behaviour, remove this plugin from `app.json`
 * and re-run `npx expo prebuild`.
 *
 * A plugin rather than a hand edit because `/android` is gitignored and
 * regenerated — an edit to `MainActivity.kt` would not survive the next
 * prebuild.
 */
const MARKER = 'pidom:font-weight-adjustment';

const OVERRIDE = `
  // ${MARKER}
  override fun applyOverrideConfiguration(overrideConfiguration: android.content.res.Configuration?) {
    if (overrideConfiguration != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      overrideConfiguration.fontWeightAdjustment = 0
    }
    super.applyOverrideConfiguration(overrideConfiguration)
  }
`;

module.exports = function withTextMeasurementFix(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'with-text-measurement-fix: MainActivity is not Kotlin; the override would not compile.',
      );
    }
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }
    // Inserted before the final brace of the class, which is the last one in
    // the file — matching how Expo's own plugins append to this class.
    const end = cfg.modResults.contents.lastIndexOf('}');
    if (end === -1) {
      throw new Error('with-text-measurement-fix: could not find the end of MainActivity.');
    }
    cfg.modResults.contents =
      cfg.modResults.contents.slice(0, end) + OVERRIDE + cfg.modResults.contents.slice(end);
    return cfg;
  });
};
