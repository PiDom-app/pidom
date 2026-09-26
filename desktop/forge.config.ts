import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    // No native addons remain (the cache uses the built-in node:sqlite), so asar
    // needs no unpacked binaries — the whole app ships inside the archive.
    asar: true,
    // The app/.exe icon (the Pidom mark, same glyph as the mobile launcher icon).
    // Extensionless on purpose: electron-packager appends .ico on Windows and
    // .png on Linux. Regenerate with `npm run icons`.
    icon: 'icons/icon',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // Installer/Setup.exe icon, the Start-menu/desktop shortcut icon, and the
      // icon shown while the Squirrel installer runs.
      setupIcon: 'icons/icon.ico',
      // The Add/Remove Programs ("Apps & features") icon. Squirrel requires a
      // URL here, not a local path; it points at the committed icon on main.
      iconUrl: 'https://raw.githubusercontent.com/PiDom-app/pidom/main/desktop/icons/icon.ico',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // Three separate Vite builds. `entry`/`config` pair the source with its
      // config; the renderer is named so BrowserWindow can resolve it.
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    // Hardening. These match the security posture documented in CLAUDE.md.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
