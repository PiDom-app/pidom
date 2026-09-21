import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/api';

/**
 * The account's public profile, shared with the phone.
 *
 * These are account-level, not desktop-local: `api.users.me` is the same row the
 * mobile app reads and writes, so a name or handle set here shows up there. The
 * desktop is just another authenticated client of the one account. Identity
 * itself is server-derived from the verified JWT; nothing here takes a user id.
 */
export function useAccountProfile() {
  const profile = useQuery(api.users.me, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const setHandle = useMutation(api.settings.setHandle);
  const deleteAccount = useMutation(api.account.deleteAccount);

  return {
    /** `undefined` while loading, `null` when signed out, else the profile. */
    profile,
    loading: profile === undefined,
    updateProfile,
    setHandle,
    deleteAccount,
  };
}
