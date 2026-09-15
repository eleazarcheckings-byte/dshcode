import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

/**
 * Biometric/passcode gate shown on resume (SPEC §8: "biometric/passcode lock
 * on resume"). `allowDeviceCredential: true` means a phone with no biometry
 * enrolled still gets a PIN/pattern/password prompt rather than no lock at
 * all — the point is "don't show session content to whoever picked up the
 * phone," not "require Face ID specifically."
 */
export async function unlockWithBiometrics(reason = 'Unlock Saturn AI'): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Not now',
      allowDeviceCredential: true,
      androidTitle: 'Saturn AI',
      androidSubtitle: reason,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the resume lock should even be shown. `allowDeviceCredential` in
 * `authenticate()` means a PIN/pattern still works with no biometry
 * enrolled, so the only real "no" here is `authenticate` itself throwing
 * `biometryNotAvailable` with no device credential fallback (checked at
 * call time in `unlockWithBiometrics`) — this helper is for screens that
 * want to skip the lock UI outright on hardware with neither.
 */
export async function deviceSupportsLock(): Promise<boolean> {
  try {
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable;
  } catch {
    return false;
  }
}
