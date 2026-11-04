// Single access-key form (typed, pasted, or a key file from Files): test (STS
// GetCallerIdentity) then save to Keychain.
// Google Cloud takes a credentials JSON instead (AddGoogle).
import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { VENDORS, type VendorId } from "@cloud-console/core/catalog";
import { errorMessage } from "@cloud-console/core/aws/errors";
import { addConnection } from "../../src/state/connections";
import { validateKey } from "../../src/services/cloud";
import { parsePastedCredential } from "../../src/pasteParser";
import { CREDENTIAL } from "../../src/vendors";
import { AddGoogle } from "../../src/screens/AddGoogle";
import { Caption, Icon, LinkRow, Screen, Section } from "../../src/components/ui";
import { MONO, useTheme } from "../../src/theme";

export default function AddVendor() {
  const { vendor } = useLocalSearchParams<{ vendor: VendorId }>();
  return vendor === "gcp" ? <AddGoogle /> : <CredentialForm />;
}

function CredentialForm() {
  const theme = useTheme();
  const { vendor: vendorId } = useLocalSearchParams<{ vendor: VendorId }>();
  const vendor = VENDORS.find((v) => v.id === vendorId);
  const shape = vendorId ? CREDENTIAL[vendorId] : undefined;
  const [name, setName] = useState("");
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [paste, setPaste] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  if (!vendor || !shape) return null;
  const input = { color: theme.text, fontSize: 17, paddingHorizontal: 16, paddingVertical: 12 } as const;
  const canSubmit = keyId.length > 0 && secret.length > 0 && !submitting;

  const onPaste = (text: string) => {
    const parsed = parsePastedCredential(text);
    if (parsed.id) setKeyId(parsed.id);
    if (parsed.secret) setSecret(parsed.secret);
    // A whole block pasted at once: back to the fields.
    if (text.length > paste.length + 1) {
      setPasteMode(false);
      setPaste("");
    } else setPaste(text);
  };

  const chooseFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const asset = r.canceled ? undefined : r.assets[0];
    if (!asset) return;
    const file = new File(asset.uri);
    const parsed = parsePastedCredential(await file.text());
    try {
      file.delete();
    } catch {
      // already gone
    }
    if (!parsed.id || !parsed.secret) {
      setError("No access key ID and secret found in that file.");
      return;
    }
    setError(undefined);
    setKeyId(parsed.id);
    setSecret(parsed.secret);
    setPasteMode(false);
    if (!name) setName(asset.name.replace(/(_accessKeys)?\.(csv|txt)$/i, "").replace(/[-_]keys$/i, ""));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await validateKey(vendor.id, keyId.trim(), secret.trim());
      await addConnection(vendor.id, name.trim() || `${vendor.name} account`, { keyPair: { id: keyId.trim(), secret: secret.trim() } });
      router.dismissAll();
    } catch (e) {
      setError(errorMessage(e));
    }
    setSubmitting(false);
  };

  return (
    <>
      <Stack.Screen options={{ title: `Add ${vendor.name}` }} />
      <Screen keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 32, marginBottom: 6, gap: 8 }}>
          <Text style={{ color: theme.secondary, fontSize: 13, textTransform: "uppercase" }}>Access key</Text>
          <Pressable onPress={() => { setPasteMode(!pasteMode); setPaste(""); }}>
            <Text style={{ color: theme.tint, fontSize: 12 }}>{pasteMode ? "(back to fields)" : "(paste info to add)"}</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityLabel="Where to find this" hitSlop={10} onPress={() => Alert.alert("Where to find this", shape.help)}>
            <Icon name="info.circle" color={theme.tint} size={18} />
          </Pressable>
        </View>
        <Section footer="Stored only in this device's Keychain. This app only ever does what this key's own permissions allow.">
          {pasteMode ? (
            <View>
              <TextInput
                value={paste}
                onChangeText={onPaste}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                style={[input, { height: 90, fontFamily: MONO, fontSize: 13 }]}
              />
              <Caption style={{ marginHorizontal: 16, marginBottom: 10 }}>{"access_key_id: …\nsecret_access_key: …"}</Caption>
            </View>
          ) : null}
          {!pasteMode ? (
            <TextInput value={keyId} onChangeText={setKeyId} placeholder={shape.idLabel} placeholderTextColor={theme.tertiary} autoCapitalize="none" autoCorrect={false} style={input} />
          ) : null}
          {!pasteMode ? (
            <TextInput value={secret} onChangeText={setSecret} placeholder={shape.secretLabel} placeholderTextColor={theme.tertiary} secureTextEntry autoCapitalize="none" autoCorrect={false} style={input} />
          ) : null}
          <LinkRow label="Choose file…" icon="doc" onPress={() => void chooseFile()} />
        </Section>
        <Section footer={`Helps tell multiple ${vendor.name} connections apart`}>
          <TextInput value={name} onChangeText={setName} placeholder="Label (optional)" placeholderTextColor={theme.tertiary} style={input} />
        </Section>
        {error ? (
          <Section>
            <View style={{ flexDirection: "row", gap: 8, padding: 12, alignItems: "center" }}>
              <Icon name="exclamationmark.triangle.fill" color={theme.orange} size={14} />
              <Caption color={theme.orange} style={{ flex: 1 }}>{error}</Caption>
            </View>
          </Section>
        ) : null}
        <Section>
          <Pressable disabled={!canSubmit} onPress={() => void submit()} style={{ flexDirection: "row", gap: 10, padding: 12, paddingHorizontal: 16, opacity: canSubmit || submitting ? 1 : 0.4 }}>
            {submitting ? <ActivityIndicator /> : null}
            <Text style={{ color: theme.tint, fontSize: 17 }}>{submitting ? "Adding…" : "Add Connection"}</Text>
          </Pressable>
        </Section>
        <Pressable onPress={() => void Linking.openURL(shape.learnMore)} hitSlop={8} style={{ alignSelf: "center", marginTop: 48, marginBottom: 24 }}>
          <Text style={{ color: theme.secondary, fontSize: 12 }}>Learn how to create a key</Text>
        </Pressable>
      </Screen>
    </>
  );
}
