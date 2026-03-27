import type { FormFoxProfile, FormFoxStorageShape } from "../types";

const STORAGE_KEY = "profiles";
const ACTIVE_KEY = "__activeProfile";

export async function getProfiles(): Promise<FormFoxProfile[]> {
  const res = await chrome.storage.local.get({ [STORAGE_KEY]: [] as FormFoxProfile[] });
  const profiles = (res as { [STORAGE_KEY]: FormFoxProfile[] })[STORAGE_KEY];
  return Array.isArray(profiles) ? profiles : [];
}

export async function setProfiles(profiles: FormFoxProfile[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: profiles });
}

export async function upsertProfile(profile: FormFoxProfile): Promise<void> {
  const profiles = await getProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  await setProfiles(profiles);
}

export async function deleteProfile(profileId: string): Promise<void> {
  const profiles = await getProfiles();
  await setProfiles(profiles.filter((p) => p.id !== profileId));
}

export async function getActiveProfile(): Promise<FormFoxProfile | null> {
  const res = await chrome.storage.local.get({ [ACTIVE_KEY]: undefined as FormFoxProfile | undefined });
  const profile = (res as FormFoxStorageShape)[ACTIVE_KEY];
  return profile ?? null;
}

export async function setActiveProfile(profile: FormFoxProfile | null): Promise<void> {
  if (!profile) {
    await chrome.storage.local.remove([ACTIVE_KEY]);
    return;
  }
  await chrome.storage.local.set({ [ACTIVE_KEY]: profile });
}

