import { useSession } from '@/providers/session-provider';
import { SettingRow, SettingsSection } from './settings-ui';
import { buttonGhostClass } from '@/lib/ui';

/**
 * Privacy & security. These map to how the app actually behaves — no invented
 * toggles. The credential at rest is the refresh token in the OS keychain; the
 * ID token stays in memory in the main process. Signing out clears cloud access
 * only.
 */
export function PrivacySection() {
  const { profile, signOut } = useSession();

  return (
    <SettingsSection
      title="Privacy & security"
      description="How this computer handles your account."
    >
      <SettingRow label="Signed-in account">
        <span className="text-sm text-fg-muted">{profile?.email ?? 'Google account'}</span>
      </SettingRow>
      <SettingRow
        label="Credential storage"
        description="Your sign-in is kept in the operating system keychain. The access token stays in memory and is never written to disk."
        align="start"
      />
      <SettingRow
        label="Local documents"
        description="Files saved on this computer stay put when you sign out. Removing a document from your library never deletes a local file."
        align="start"
      />
      <SettingRow label="Sign out of this computer">
        <button className={buttonGhostClass} onClick={() => void signOut()}>
          Sign out
        </button>
      </SettingRow>
    </SettingsSection>
  );
}
