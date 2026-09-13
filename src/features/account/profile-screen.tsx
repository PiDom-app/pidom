import { useRouter } from 'expo-router';
import { AtSign, ImageOff, User } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { ABOUT_MAX, DISPLAY_NAME_MAX, HANDLE_MAX, PRONOUNS_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { Screen } from '@/components/layout/screen';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Button, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useSession } from '@/features/auth/session-provider';
import { NameDialog } from '@/features/library/components/name-dialog';
import { messageOf } from '@/features/library/data/errors';
import {
  ListSkeleton,
  Notice,
  ScreenHeader,
  Section,
} from '@/features/sharing/components/segments';

/**
 * The name and the face other people see.
 *
 * Two fields, and the shortness is the point. Everything on this screen renders
 * on somebody else's device — in a share row, in a group's member list, beside
 * a note on a document they own — so each field here is a field this account
 * can put in front of a stranger, and the list of those should be as short as
 * the product allows.
 *
 * **There is no photo URL field.** A string the reader types and this
 * deployment then renders on other people's screens is a tracking pixel with a
 * profile around it: whoever controls that host learns the address and the
 * moment of every person who opens a screen the reader appears on. The choice
 * offered instead is the honest one — the photo from the account they signed in
 * with, or none at all.
 *
 * **The address is shown and cannot be edited.** It is Google's, it is how the
 * account is found by people who already have it, and a field that let it be
 * changed here would be a field that let one account claim another's identity
 * in every search result.
 */
export function ProfileScreen() {
  const router = useRouter();
  const { account } = useSession();
  const profile = useQuery(api.users.me, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const setHandle = useMutation(api.settings.setHandle);
  const showToast = useAppToast();

  /**
   * What has been typed, if anything. `null` means "not edited yet".
   *
   * Derived rather than seeded from the account in an effect: the query answers
   * a round trip after the first render, and an effect that copies it into
   * state is both a second source of truth and a cascading render. The value
   * shown is the edit when there is one and the account's otherwise, which is
   * also what makes `dirty` below a comparison rather than a flag.
   */
  const [editedName, setEditedName] = useState<string | null>(null);
  const [editedPhoto, setEditedPhoto] = useState<boolean | null>(null);
  const [editedPronouns, setEditedPronouns] = useState<string | null>(null);
  const [editedAbout, setEditedAbout] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [saving, setSaving] = useState(false);

  const savedName = profile?.name ?? '';
  // The projection returns `null` for a hidden photo, so the switch reads the
  // same value everybody else sees rather than a separate flag that could
  // disagree with it.
  const savedPhoto = profile == null ? true : profile.pictureUrl !== null;

  const savedPronouns = profile?.pronouns ?? '';
  const savedAbout = profile?.about ?? '';

  const name = editedName ?? savedName;
  const showPhoto = editedPhoto ?? savedPhoto;
  const pronouns = editedPronouns ?? savedPronouns;
  const about = editedAbout ?? savedAbout;

  const googlePhoto = account?.photoUrl ?? null;

  /**
   * The same claim Sharing & privacy makes, against the same mutation.
   *
   * Duplicated as a call site and not as a rule: `settings.setHandle` owns
   * normalising, refusing a taken one and the reserved list. Two screens
   * offering it is two doors to one room, which is the right number when the
   * room is "the name people find you by" and both screens are about being
   * found.
   */
  const claim = useCallback(
    async (handle: string): Promise<boolean> => {
      try {
        await setHandle({ handle });
        setClaiming(false);
        return true;
      } catch (error) {
        showToast({
          id: 'handle',
          tone: 'error',
          title: 'That handle could not be taken',
          description: messageOf(error, 'Try another one.'),
        });
        return false;
      }
    },
    [setHandle, showToast],
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await updateProfile({
        displayName: name,
        showPhoto,
        pronouns: pronouns.trim(),
        about: about.trim(),
      });
      showToast({ id: 'profile', tone: 'success', title: 'Profile updated' });
      router.back();
    } catch {
      showToast({
        id: 'profile',
        tone: 'error',
        title: 'That could not be saved',
        description: 'Check your connection and try again.',
      });
    } finally {
      setSaving(false);
    }
  }, [name, router, showPhoto, showToast, updateProfile]);

  if (profile === undefined) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={User} title="Profile" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <ListSkeleton rows={3} />
      </Screen>
    );
  }

  const shown = showPhoto ? (googlePhoto ?? profile?.pictureUrl ?? null) : null;
  const dirty =
    name.trim() !== savedName ||
    showPhoto !== savedPhoto ||
    pronouns.trim() !== savedPronouns ||
    about.trim() !== savedAbout;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={User}
        title="Profile"
        subtitle="What other people see"
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <ScrollView contentContainerStyle={CONTENT}>
        {/* Left-aligned rather than a centred hero: this is a preview of a row
            in somebody else's list, and that is what it should look like. */}
        <HStack className="items-center px-4 pt-4 pb-1" space="md">
          <Avatar className="h-14 w-14">
            <AvatarFallbackText>{name === '' ? 'Reader' : name}</AvatarFallbackText>
            <AvatarImage source={{ uri: shown }} />
          </Avatar>
          <VStack className="flex-1">
            <Text size="sm" className="font-semibold text-foreground">
              {name.trim() === '' ? 'Your name' : name}
            </Text>
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              How you appear on a share you send
            </Text>
          </VStack>
        </HStack>

        <Section title="Display name">
          <VStack className="px-4 pt-1" space="xs">
            <Input className="h-11">
              <InputField
                value={name}
                onChangeText={setEditedName}
                placeholder="Your name"
                maxLength={DISPLAY_NAME_MAX}
                autoCapitalize="words"
                autoCorrect={false}
                className="text-foreground"
              />
            </Input>
            <Text size="xs" className="text-fg-subtle">
              Leave it empty to go back to the name on your Google account.
            </Text>
          </VStack>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* Optional, and shown wherever this person appears to somebody else.
            Free text rather than a list of options, because a list is a claim
            about which answers exist. */}
        <Section title="Pronouns">
          <VStack className="px-4 pt-1" space="xs">
            <Input className="h-11">
              <InputField
                value={pronouns}
                onChangeText={setEditedPronouns}
                placeholder="they/them"
                maxLength={PRONOUNS_MAX}
                autoCapitalize="none"
                autoCorrect={false}
                className="text-foreground"
              />
            </Input>
            <Text size="xs" className="text-fg-subtle">
              Shown beside your name to people you share with. Leave it empty for nothing.
            </Text>
          </VStack>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        <Section title="About">
          <VStack className="px-4 pt-1" space="xs">
            <Input className="h-20 items-start py-2">
              <InputField
                value={about}
                onChangeText={setEditedAbout}
                placeholder="A line about you"
                maxLength={ABOUT_MAX}
                multiline
                textAlignVertical="top"
                className="text-foreground"
              />
            </Input>
            <Text size="xs" className="text-fg-subtle">
              {`On your profile card, where somebody decides whether to share with you. ${
                ABOUT_MAX - about.length
              } left.`}
            </Text>
          </VStack>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        <Section title="Photo">
          <HStack className="items-center px-4 py-2" space="lg">
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                Show my Google photo
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {googlePhoto === null
                  ? 'Your Google account has no photo, so nothing shows either way.'
                  : 'Off shows your initials instead, everywhere anybody sees you.'}
              </Text>
            </VStack>
            <Switch
              value={showPhoto}
              onValueChange={setEditedPhoto}
              accessibilityLabel="Show my Google photo"
            />
          </HStack>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        <Section title="Account">
          <HStack className="items-center px-4 py-2" space="lg">
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                {profile?.email ?? account?.email ?? 'Your address'}
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                From Google, and not editable here.
              </Text>
            </VStack>
          </HStack>
          {/* This was a row that told you to go somewhere else, which is the
              one thing a settings row should never be: the reader is already
              on the screen about their profile and a handle is part of it. It
              opens the same dialog Sharing & privacy does, against the same
              mutation, so there is still one place the rule lives. */}
          <Pressable
            onPress={() => setClaiming(true)}
            accessibilityRole="button"
            accessibilityLabel="Your handle"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <HStack className="items-center" space="lg">
              <VStack className="flex-1">
                <Text size="md" className="text-foreground">
                  Handle
                </Text>
                <Text size="xs" className="mt-0.5 text-fg-subtle">
                  What people look you up by. Nothing else finds you except an address they already
                  have.
                </Text>
              </VStack>
              <Text size="md" className="text-fg-muted">
                {profile?.handle == null ? 'Not set' : `@${profile.handle}`}
              </Text>
            </HStack>
          </Pressable>
        </Section>

        <Notice glyph={showPhoto ? AtSign : ImageOff}>
          Your address is never returned by a search. People find you by an exact handle, or by an
          address they already had.
        </Notice>
      </ScrollView>

      <NameDialog
        isOpen={claiming}
        onClose={() => setClaiming(false)}
        onSubmit={claim}
        title="Your handle"
        label="Handle"
        placeholder="amina"
        initialValue={profile?.handle ?? ''}
        maxLength={HANDLE_MAX}
      />

      <Divider className="bg-hairline" />
      <VStack className="px-4 pt-3 pb-2">
        <Button
          size="lg"
          className="h-11"
          isDisabled={!dirty || saving}
          onPress={() => void save()}
        >
          <ButtonText>{saving ? 'Saving…' : 'Save'}</ButtonText>
        </Button>
      </VStack>
    </Screen>
  );
}

const CONTENT = { paddingBottom: 24 } as const;
