// Add Google Cloud: a credentials JSON from Files (AirDrop / iCloud Drive) or
// the clipboard (Universal Clipboard from a Mac) — a service account key or
// gcloud ADC — optionally acting as a service account. Test, then Keychain.
import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { errorMessage } from "@cloud-console/core/aws/errors";
import { credentialsLabel, parseCredentials } from "@cloud-console/core/gcp/credentials";
import type { GoogleCredentials } from "@cloud-console/core/gcp/auth";
import { addConnection } from "../state/connections";
import { validateGoogle } from "../services/cloud";
import { Caption, DetailRow, Icon, LinkRow, Screen, Section } from "../components/ui";
import { useTheme } from "../theme";

const LEARN_MORE = "https://github.com/solomonxie/cloud-console/blob/master/docs/gcp-access.md";

const HELP =
  "A service account JSON key is easiest: create one in the console (IAM → Service Accounts → Keys → Add key → JSON), then AirDrop it, save it to iCloud Drive, or copy it on a Mac and paste here.\n\n" +
  "gcloud's application default credentials (application_default_credentials.json) work too and act as your own Google account.\n\n" +
  "This app only ever does what those credentials' own IAM roles allow.";

const KIND: Record<NonNullable<GoogleCredentials["type"]>, string> = {
  service_account: "Service account key",
  authorized_user: "gcloud user credentials",
  impersonated_service_account: "Impersonated service account",
};

export function AddGoogle() {
  const theme = useTheme();
  const [json, setJson] = useState("");
  const [creds, setCreds] = useState<GoogleCredentials>();
  const [impersonate, setImpersonate] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const input = { color: theme.text, fontSize: 17, paddingHorizontal: 16, paddingVertical: 12 } as const;

  const load = (text: string) => {
    setError(undefined);
    try {
      setCreds(parseCredentials(text.trim()));
      setJson(text.trim());
    } catch (e) {
      setCreds(undefined);
      setJson("");
      setError(errorMessage(e));
    }
  };

  const chooseFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const asset = r.canceled ? undefined : r.assets[0];
    if (!asset) return;
    const file = new File(asset.uri);
    load(await file.text());
    // The picked copy holds a private key; don't leave it in the cache.
    try {
      file.delete();
    } catch {
      // already gone
    }
  };

  const paste = async () => load(await Clipboard.getStringAsync());

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const email = impersonate.trim();
      const { creds: effective, project } = await validateGoogle(json, email);
      await addConnection("gcp", name.trim() || credentialsLabel(effective), { google: { json, ...(email ? { impersonate: email } : {}) } }, project);
      router.dismissAll();
    } catch (e) {
      setError(errorMessage(e));
    }
    setSubmitting(false);
  };

  const canSubmit = !!creds && !submitting;
  return (
    <>
      <Stack.Screen options={{ title: "Add Google Cloud" }} />
      <Screen keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 32, marginBottom: 6 }}>
          <Text style={{ flex: 1, color: theme.secondary, fontSize: 13, textTransform: "uppercase" }}>Credentials JSON</Text>
          <Pressable accessibilityLabel="Where to find this" hitSlop={10} onPress={() => Alert.alert("Where to find this", HELP)}>
            <Icon name="info.circle" color={theme.tint} size={18} />
          </Pressable>
        </View>
        <Section footer="Stored only in this device's Keychain, sent only to Google to get access tokens.">
          {creds ? (
            <>
              <DetailRow label="Type" value={creds.type ? KIND[creds.type] : KIND.service_account} />
              <DetailRow label="Identity" value={credentialsLabel(creds)} />
              <LinkRow label="Use a different file" icon="arrow.uturn.backward" onPress={() => { setCreds(undefined); setJson(""); }} />
            </>
          ) : (
            <>
              <LinkRow label="Choose file…" icon="doc" onPress={() => void chooseFile()} />
              <LinkRow label="Paste from clipboard" icon="doc.on.clipboard" onPress={() => void paste()} />
            </>
          )}
        </Section>
        <Section title="Act as service account" footer="Optional. The credentials above only mint its tokens — they need Service Account Token Creator on it.">
          <TextInput
            value={impersonate}
            onChangeText={setImpersonate}
            placeholder="name@project.iam.gserviceaccount.com"
            placeholderTextColor={theme.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={input}
          />
        </Section>
        <Section footer="Helps tell multiple Google Cloud connections apart">
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
        <Pressable onPress={() => void Linking.openURL(LEARN_MORE)} hitSlop={8} style={{ alignSelf: "center", marginTop: 48, marginBottom: 24 }}>
          <Text style={{ color: theme.secondary, fontSize: 12 }}>Learn how to create a key</Text>
        </Pressable>
      </Screen>
    </>
  );
}
