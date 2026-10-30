// App lock (port of AppLockManager): Face ID and/or a 4-digit passcode
// gating the app on launch and on return from background. The passcode is
// kept only as a salted SHA-256 hash, in the Keychain.
import * as LocalAuthentication from "expo-local-authentication";
import { sha256Hex } from "@cloud-console/core/crypto/hash";
import { createStore } from "../state/store";
import { deleteSecret, loadSecret, saveSecret } from "./keychain";
import { settings, updateSettings } from "./settings";

const HASH_KEY = "applock.passcode.hash";

export const lockState = createStore<{ locked: boolean }>({ locked: false });

const hash = (passcode: string) => sha256Hex(`cloudconsole-applock:${passcode}`);

export function lockEnabled(): boolean {
  const s = settings.get();
  return s.faceIDEnabled || s.passcodeEnabled;
}

export function lock(): void {
  if (lockEnabled()) lockState.set({ locked: true });
}

export function unlock(): void {
  lockState.set({ locked: false });
}

export async function setPasscode(passcode: string, hint: string): Promise<void> {
  await saveSecret(HASH_KEY, hash(passcode));
  updateSettings({ passcodeEnabled: true, passcodeHint: hint.trim() || undefined });
}

export async function clearPasscode(): Promise<void> {
  await deleteSecret(HASH_KEY);
  updateSettings({ passcodeEnabled: false, passcodeHint: undefined });
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const stored = await loadSecret(HASH_KEY);
  return stored !== null && stored === hash(passcode);
}

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  if (!(await biometricsAvailable())) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Cloud Console",
    disableDeviceFallback: true,
    cancelLabel: "Cancel",
  });
  return result.success;
}
