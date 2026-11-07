export type PreferenceKey = 'motion' | 'texture' | 'sound';

export const preferences: Record<PreferenceKey, boolean> = {
  motion: true,
  texture: true,
  sound: true,
};

const storageKey = 'plakoto-preferences';

export function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<
      typeof preferences
    >;
    (Object.keys(preferences) as PreferenceKey[]).forEach((key) => {
      if (typeof stored[key] === 'boolean') preferences[key] = stored[key];
    });
  } catch {
    // Private mode and corrupt storage both fall back to defaults.
  }
}

export function savePreferences() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Ignore quota and private-mode failures; the session still keeps the choice.
  }
}
