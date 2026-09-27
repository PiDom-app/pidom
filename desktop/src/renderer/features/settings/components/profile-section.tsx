import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { AtSign, Loader2 } from 'lucide-react';
import {
  ABOUT_MAX,
  DISPLAY_NAME_MAX,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  PRONOUNS_MAX,
} from '@convex-model/limits';
import { useSession } from '@/providers/session-provider';
import { useAccountProfile } from '../use-account-profile';
import { SettingRow, SettingsSection, ToggleSetting } from './settings-ui';
import { buttonPrimaryClass, inputClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The public profile — the name, pronouns, blurb, photo, and handle other people
 * see on a share. It is the desktop face of the mobile Profile screen and writes
 * the same account row (`api.users.updateProfile` / `api.settings.setHandle`), so
 * a change here reaches the phone. Email comes from Google and is not editable.
 *
 * State is *derived*, not seeded by an effect: each field shows the edit when
 * there is one and the account's value otherwise. The query answers a round trip
 * after first render, and copying it into state in an effect would be a second
 * source of truth that fights the reactive update — the bug that made edits
 * appear to "not save". `dirty` is therefore a comparison, and a successful save
 * just drops the edits so the fields fall back to the freshly-synced account.
 */
export function ProfileSection() {
  const { profile: sessionProfile } = useSession();
  const { profile, updateProfile, setHandle } = useAccountProfile();

  const [editedName, setEditedName] = useState<string | null>(null);
  const [editedPronouns, setEditedPronouns] = useState<string | null>(null);
  const [editedAbout, setEditedAbout] = useState<string | null>(null);
  const [editedPhoto, setEditedPhoto] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const savedName = profile?.name ?? '';
  // The projection returns null for a hidden photo, so the switch reads the same
  // value everyone else sees rather than a separate flag that could disagree.
  const savedPhoto = profile == null ? true : profile.pictureUrl !== null;
  const savedPronouns = profile?.pronouns ?? '';
  const savedAbout = profile?.about ?? '';

  const name = editedName ?? savedName;
  const showPhoto = editedPhoto ?? savedPhoto;
  const pronouns = editedPronouns ?? savedPronouns;
  const about = editedAbout ?? savedAbout;

  const googlePhoto = sessionProfile?.picture ?? null;

  const dirty =
    name.trim() !== savedName ||
    showPhoto !== savedPhoto ||
    pronouns.trim() !== savedPronouns ||
    about.trim() !== savedAbout;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await updateProfile({
        displayName: name.trim(),
        showPhoto,
        pronouns: pronouns.trim(),
        about: about.trim(),
      });
      // Drop the edits; the fields fall back to the account, which the reactive
      // query updates to the values just written.
      setEditedName(null);
      setEditedPronouns(null);
      setEditedAbout(null);
      setEditedPhoto(null);
      toast.success('Profile updated');
    } catch {
      toast.error("That couldn't be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [about, name, pronouns, showPhoto, updateProfile]);

  if (profile === undefined) {
    return (
      <SettingsSection title="Profile" description="How you appear on a share you send.">
        <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          Loading your profile…
        </div>
      </SettingsSection>
    );
  }

  if (profile === null) {
    return (
      <SettingsSection title="Profile" description="How you appear on a share you send.">
        <p className="py-6 text-sm text-fg-muted">Sign in to edit your profile.</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Profile" description="How you appear on a share you send.">
      <SettingRow
        label="Display name"
        description="Leave it empty to use the name on your Google account."
        align="start"
      >
        <input
          value={name}
          onChange={(e) => setEditedName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          placeholder="Your name"
          aria-label="Display name"
          className={cn(inputClass, 'w-64')}
        />
      </SettingRow>

      <SettingRow
        label="Pronouns"
        description="Shown beside your name to people you share with. Leave it empty for nothing."
        align="start"
      >
        <input
          value={pronouns}
          onChange={(e) => setEditedPronouns(e.target.value)}
          maxLength={PRONOUNS_MAX}
          placeholder="they/them"
          aria-label="Pronouns"
          className={cn(inputClass, 'w-64')}
        />
      </SettingRow>

      <SettingRow
        label="About"
        description={`A line about you. ${ABOUT_MAX - about.length} left.`}
        align="start"
      >
        <textarea
          value={about}
          onChange={(e) => setEditedAbout(e.target.value)}
          maxLength={ABOUT_MAX}
          rows={2}
          placeholder="A line about you"
          aria-label="About"
          className={cn(inputClass, 'w-64 resize-none')}
        />
      </SettingRow>

      <SettingRow
        label="Show my Google photo"
        description={
          googlePhoto === null
            ? 'Your Google account has no photo, so nothing shows either way.'
            : 'Off shows your initials instead, everywhere anybody sees you.'
        }
      >
        <ToggleSetting
          label="Show my Google photo"
          checked={showPhoto}
          onCheckedChange={setEditedPhoto}
        />
      </SettingRow>

      <HandleRow current={profile.handle} onClaim={(handle) => setHandle({ handle })} />

      <SettingRow label="Email" description="From Google, and not editable here.">
        <span className="text-sm text-fg-muted">{profile.email}</span>
      </SettingRow>

      <div className="flex items-center justify-end gap-3 pt-5">
        {dirty && <span className="text-sm text-fg-subtle">Unsaved changes</span>}
        <button
          className={buttonPrimaryClass}
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </SettingsSection>
  );
}

/**
 * The handle claim. Separate from the profile save because it has its own server
 * mutation and rate bucket — a handle lookup is how one account finds another, so
 * a claim is metered. Validated locally against the same rules the server uses so
 * an obviously bad handle never spends a token; the server owns the final word on
 * whether it is taken or reserved.
 */
function HandleRow({
  current,
  onClaim,
}: {
  current: string | null;
  onClaim: (handle: string) => Promise<string>;
}) {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const normalized = value.trim().toLowerCase();
  const valid =
    normalized.length >= HANDLE_MIN &&
    normalized.length <= HANDLE_MAX &&
    HANDLE_PATTERN.test(normalized);

  const claim = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onClaim(normalized);
      setEditing(false);
      setValue('');
      toast.success(`Handle set to @${normalized}`);
    } catch {
      toast.error('That handle is taken or not allowed. Try another.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      label="Handle"
      description="What people look you up by. Letters, numbers and underscores, 3–24 characters."
      align="start"
    >
      {editing ? (
        <div className="flex w-64 flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <AtSign className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void claim();
                  if (e.key === 'Escape') {
                    setEditing(false);
                    setValue('');
                  }
                }}
                maxLength={HANDLE_MAX}
                placeholder="yourhandle"
                aria-label="Handle"
                className={cn(inputClass, 'pl-8')}
              />
            </div>
            <button
              className={buttonPrimaryClass}
              disabled={!valid || busy}
              onClick={() => void claim()}
            >
              {busy ? 'Claiming…' : 'Claim'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-link outline-none hover:text-link-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          {current ? `@${current}` : 'Set a handle'}
        </button>
      )}
    </SettingRow>
  );
}
