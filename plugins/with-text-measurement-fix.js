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

/**
 * Matches a block this plugin wrote before, whichever form it was.
 *
 * The guard used to be `contents.includes(MARKER) → return`, which made the
 * override **unupgradable**: the first version of this fix used
 * `applyOverrideConfiguration`, that version does not work, and every prebuild
 * after it saw its own marker and left it there. The stale one shipped, and the
 * symptom was the symptom this plugin exists to prevent — a device with Bold
 * text on rendered "Contents" as "Content" in a build whose source contained
 * the working fix. Found with `dumpsys activity activities`, which reported
 * `fontWeightAdjustment=300` on an activity that was supposed to have cleared
 * it.
 *
 * So the block is replaced rather than skipped. The comment marker opens it and
 * the function it introduces closes it, which is what this matches.
 */
const EXISTING = new RegExp(`\\n?\\s*// ${MARKER}[\\s\\S]*?\\n  \\}\\n`, 'm');

/**
 * `attachBaseContext`, not `applyOverrideConfiguration`.
 *
 * The tidier-looking hook does not work here. The framework hands
 * `applyOverrideConfiguration` the activity's *own* override configuration,
 * which for a plain fullscreen activity is empty — the bold-text bump lives in
 * the global configuration it gets merged into, so writing the field on the
 * override never reached the configuration the resources are built from.
 * `dumpsys activity activities` showed the activity still reporting
 * `fontWeightAdjustment=300` with the override in place, and text still lost
 * its last word.
 *
 * Rebuilding the base context is the form that holds: it replaces the
 * configuration the Activity's `Resources` are created from, before any View
 * in it has resolved a typeface.
 */
const OVERRIDE = `
  // ${MARKER}
  override fun attachBaseContext(newBase: android.content.Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val config = android.content.res.Configuration(newBase.resources.configuration)
      config.fontWeightAdjustment = 0
      super.attachBaseContext(newBase.createConfigurationContext(config))
    } else {
      super.attachBaseContext(newBase)
    }
  }
`;

module.exports = function withTextMeasurementFix(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'with-text-measurement-fix: MainActivity is not Kotlin; the override would not compile.',
      );
    }
    // Replaced, not skipped. See EXISTING for what skipping cost.
    if (EXISTING.test(cfg.modResults.contents)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(EXISTING, '\n');
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
