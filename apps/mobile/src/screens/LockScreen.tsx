// Full-screen cover while locked — Face ID first, passcode fallback.
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authenticateWithBiometrics, unlock, verifyPasscode } from "../services/applock";
import { settings } from "../services/settings";
import { useStore } from "../state/store";
import { NumberPad, PasscodeDots } from "../components/PasscodePad";
import { Button, Icon } from "../components/ui";
import { useTheme } from "../theme";

export function LockScreen() {
  const theme = useTheme();
  const s = useStore(settings);
  const [showPad, setShowPad] = useState(!s.faceIDEnabled && s.passcodeEnabled);
  const [authenticating, setAuthenticating] = useState(false);

  const authenticate = async () => {
    setAuthenticating(true);
    const ok = await authenticateWithBiometrics();
    setAuthenticating(false);
    if (ok) unlock();
    else if (settings.get().passcodeEnabled) setShowPad(true);
  };

  useEffect(() => {
    if (!showPad) void authenticate();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, justifyContent: "center" }}>
      {showPad ? (
        <PasscodeEntry hint={s.passcodeHint} onFallback={s.faceIDEnabled ? () => setShowPad(false) : undefined} />
      ) : (
        <View style={{ alignItems: "center", gap: 20 }}>
          <Icon name="lock.fill" color={theme.secondary} size={44} />
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>Cloud Console Locked</Text>
          <Button label="Unlock with Face ID" icon="faceid" prominent disabled={authenticating} onPress={() => void authenticate()} />
          {s.passcodeEnabled ? <Button label="Use Passcode" onPress={() => setShowPad(true)} /> : null}
        </View>
      )}
    </SafeAreaView>
  );
}

function PasscodeEntry({ hint, onFallback }: { hint?: string; onFallback?: () => void }) {
  const theme = useTheme();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState(false);

  const append = async (d: string) => {
    if (digits.length >= 4) return;
    setError(false);
    const next = digits + d;
    setDigits(next);
    if (next.length === 4) {
      if (await verifyPasscode(next)) unlock();
      else {
        setError(true);
        setDigits("");
      }
    }
  };

  return (
    <View style={{ alignItems: "center", gap: 28, paddingHorizontal: 40 }}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>Enter Passcode</Text>
        {hint ? <Text style={{ color: theme.secondary, fontSize: 15 }}>Hint: {hint}</Text> : null}
        <Text style={{ color: theme.red, fontSize: 12 }}>{error ? "Incorrect passcode" : " "}</Text>
      </View>
      <PasscodeDots filled={digits.length} />
      <NumberPad onDigit={(d) => void append(d)} onDelete={() => setDigits((x) => x.slice(0, -1))} />
      {onFallback ? <Button label="Use Face ID Instead" onPress={onFallback} /> : null}
    </View>
  );
}
