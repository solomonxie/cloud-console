// App preferences (UserDefaults in the Swift app) on AsyncStorage. Never
// holds credentials or the passcode — those are in the Keychain.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "../state/store";

export interface Settings {
  demoOn: boolean;
  /** Bumped by "Reset demo data" so Home rebuilds from the preset. */
  demoGeneration: number;
  faceIDEnabled: boolean;
  passcodeEnabled: boolean;
  passcodeHint?: string;
}

const KEYS = {
  demoOn: "demo.on",
  demoGeneration: "demo.generation",
  faceIDEnabled: "applock.faceid.enabled",
  passcodeEnabled: "applock.passcode.enabled",
  passcodeHint: "applock.passcode.hint",
} as const;

export const settings = createStore<Settings>({
  demoOn: false,
  demoGeneration: 0,
  faceIDEnabled: false,
  passcodeEnabled: false,
});

export async function loadSettings(): Promise<Settings> {
  const entries = await AsyncStorage.multiGet(Object.values(KEYS));
  const map = Object.fromEntries(entries);
  const loaded: Settings = {
    demoOn: map[KEYS.demoOn] === "true",
    demoGeneration: Number(map[KEYS.demoGeneration] ?? 0) || 0,
    faceIDEnabled: map[KEYS.faceIDEnabled] === "true",
    passcodeEnabled: map[KEYS.passcodeEnabled] === "true",
    passcodeHint: map[KEYS.passcodeHint] ?? undefined,
  };
  settings.set(loaded);
  return loaded;
}

export function updateSettings(change: Partial<Settings>): void {
  settings.set((prev) => ({ ...prev, ...change }));
  for (const [field, value] of Object.entries(change) as [keyof Settings, unknown][]) {
    const key = KEYS[field];
    if (value === undefined || value === null || value === "") void AsyncStorage.removeItem(key);
    else void AsyncStorage.setItem(key, String(value));
  }
}

export const isDemo = (): boolean => settings.get().demoOn;
