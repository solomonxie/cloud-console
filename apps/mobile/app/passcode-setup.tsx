// Enter, confirm, then an optional hint — like iOS's own passcode prompts.
import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { setPasscode } from "../src/services/applock";
import { NumberPad, PasscodeDots } from "../src/components/PasscodePad";
import { Button, Screen } from "../src/components/ui";
import { useTheme } from "../src/theme";

export default function PasscodeSetup() {
  const theme = useTheme();
  const [step, setStep] = useState<"create" | "confirm" | "hint">("create");
  const [first, setFirst] = useState("");
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState("");

  const append = (d: string) => {
    if (digits.length >= 4) return;
    setError(undefined);
    const next = digits + d;
    if (next.length < 4) return setDigits(next);
    if (step === "create") {
      setFirst(next);
      setDigits("");
      setStep("confirm");
    } else if (next === first) {
      setDigits("");
      setStep("hint");
    } else {
      setError("Passcodes didn't match — try again.");
      setDigits("");
      setFirst("");
      setStep("create");
    }
  };

  return (
    <Screen style={{ alignItems: "center", gap: 24, paddingHorizontal: 40, paddingTop: 24 }}>
      {step === "hint" ? (
        <>
          <View style={{ alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>Add a Hint</Text>
            <Text style={{ color: theme.secondary, fontSize: 15, textAlign: "center" }}>
              Shown on the lock screen if you forget your passcode. Don't make it the passcode itself.
            </Text>
          </View>
          <TextInput
            value={hint}
            onChangeText={setHint}
            placeholder="Hint (optional)"
            placeholderTextColor={theme.tertiary}
            style={{ alignSelf: "stretch", borderWidth: 1, borderColor: theme.separator, borderRadius: 8, padding: 10, color: theme.text, backgroundColor: theme.card }}
          />
          <Button
            label="Save"
            prominent
            onPress={() => {
              void setPasscode(first, hint).then(() => router.back());
            }}
          />
        </>
      ) : (
        <>
          <View style={{ alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>Passcode</Text>
            <Text style={{ color: theme.secondary, fontSize: 15 }}>{step === "create" ? "Enter a 4-digit passcode." : "Re-enter your passcode."}</Text>
            <Text style={{ color: theme.red, fontSize: 12 }}>{error ?? " "}</Text>
          </View>
          <PasscodeDots filled={digits.length} />
          <NumberPad onDigit={append} onDelete={() => setDigits((x) => x.slice(0, -1))} />
        </>
      )}
      <Button label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}
