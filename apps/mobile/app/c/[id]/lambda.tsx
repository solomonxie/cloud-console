// Lambda: details and a run panel — JSON input → live CloudWatch log of that
// run → response. Runs only after a confirmation (real side effects).
import React, { useEffect, useRef, useState } from "react";
import { Alert, ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LambdaFunctionSummary, LambdaInvocation } from "@cloud-console/core/aws/lambda";
import type { LogEvent } from "@cloud-console/core/aws/cloudwatch-logs";
import { byteCount, formatClock } from "@cloud-console/core/format";
import { prettyJsonString } from "@cloud-console/core/detail";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { isDemo } from "../../../src/services/settings";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { Caption, CodeBlock, DetailRow, Icon, LinkRow, Screen, Section } from "../../../src/components/ui";
import { MONO, useTheme } from "../../../src/theme";

/** CloudWatch lags a few seconds behind the invoke's return. */
const LOG_GRACE = 20_000;

function validJson(text: string): string | undefined {
  const trimmed = text.trim() || "{}";
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function LambdaDetail() {
  const theme = useTheme();
  const { region } = useLocalSearchParams<{ region: string }>();
  const fn = useJsonParam<LambdaFunctionSummary>("fn");
  const { session } = useSession();
  const inputKey = `lambda.input.${region}/${fn?.name}`;
  const [input, setInput] = useState("{}");
  const [running, setRunning] = useState(false);
  const [tailing, setTailing] = useState(false);
  const [result, setResult] = useState<LambdaInvocation>();
  const [error, setError] = useState<string>();
  const [liveLog, setLiveLog] = useState<LogEvent[]>([]);
  const alive = useRef(true);
  const resultRef = useRef<LambdaInvocation | undefined>(undefined);

  useEffect(() => {
    void AsyncStorage.getItem(inputKey).then((v) => v !== null && setInput(v));
    return () => {
      alive.current = false;
    };
  }, [inputKey]);

  if (!fn) return null;
  const payload = validJson(input);

  /** Polls this run's log window until its REPORT line shows up, or the grace runs out. */
  const tailLogs = async (from: number, latest: number, cancelled: { value: boolean }) => {
    if (isDemo() || !session) return;
    setTailing(true);
    let finishedAt: number | undefined;
    while (alive.current && !cancelled.value && Date.now() < latest) {
      try {
        const events = await cloud.lambdaLogs(session, fn.name, from, latest, region);
        if (alive.current) setLiveLog(events);
        const r = resultRef.current;
        if (r?.requestID && events.some((e) => e.message.includes(`REPORT RequestId: ${r.requestID}`))) break;
      } catch {
        // keep polling; the log group may not exist yet
      }
      const r = resultRef.current;
      if (r) {
        // The invoke's own log tail is complete when it still has the START line.
        if (r.requestID && r.log?.includes(`START RequestId: ${r.requestID}`)) break;
        finishedAt = finishedAt ?? Date.now();
        if (Date.now() - finishedAt > LOG_GRACE) break;
      }
      await sleep(2000);
    }
    if (alive.current) setTailing(false);
  };

  const run = async () => {
    if (!session || !payload) return;
    void AsyncStorage.setItem(inputKey, input);
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    resultRef.current = undefined;
    setLiveLog([]);
    const started = Date.now();
    // Never look past the function's own max runtime.
    const latest = started + (fn.timeout ?? 900) * 1000 + LOG_GRACE;
    const cancelled = { value: false };
    const tail = tailLogs(started - 2000, latest, cancelled);
    try {
      const r = await cloud.invokeLambda(session, fn.name, payload, region);
      resultRef.current = r;
      if (alive.current) setResult(r);
    } catch (e) {
      cancelled.value = true;
      if (alive.current) setError(errorMessage(e));
    }
    if (alive.current) setRunning(false);
    await tail;
  };

  const confirmRun = () =>
    Alert.alert(`Run ${fn.name}?`, "This executes the function for real, with whatever side effects it has.", [
      { text: "Cancel", style: "cancel" },
      { text: "Run", onPress: () => void run() },
    ]);

  const fields: [string, string][] = [
    ["Function", fn.name],
    ["Description", fn.description || "—"],
    ["Runtime", fn.runtime ?? "—"],
    ["Handler", fn.handler ?? "—"],
    ["Memory", fn.memorySize !== undefined ? `${fn.memorySize} MB` : "—"],
    ["Timeout", fn.timeout !== undefined ? `${fn.timeout} s` : "—"],
    ["Code size", fn.codeSize !== undefined ? byteCount(fn.codeSize) : "—"],
    ["Last modified", fn.lastModified ?? "—"],
    ["ARN", fn.arn ?? "—"],
    ["Region", region],
  ];

  const isErrorLine = (m: string) => m.includes("ERROR") || m.includes("Task timed out") || m.includes("Traceback");

  return (
    <>
      <Stack.Screen options={{ title: fn.name }} />
      <Screen>
        <Section title="Details">
          {fields.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} wrap={label === "Function"} />
          ))}
        </Section>
        <Section title="Input (JSON event)" footer={payload ? undefined : <Caption color={theme.red}>Not valid JSON.</Caption>}>
          <TextInput
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={{ minHeight: 120, padding: 12, fontFamily: MONO, fontSize: 13, color: theme.text, textAlignVertical: "top" }}
          />
          <LinkRow label={running ? "Running…" : "Run"} icon="play.fill" disabled={running || !payload} onPress={confirmRun} trailing={running ? <ActivityIndicator /> : undefined} />
        </Section>
        {running || tailing || result ? (
          <Section title="Logs">
            <View style={{ padding: 12, gap: 6 }}>
              {liveLog.length === 0 && !(result?.log ?? "") && !tailing ? (
                <Caption>No log output.</Caption>
              ) : (
                <ScrollView style={{ height: 260 }} nestedScrollEnabled ref={(r) => r?.scrollToEnd({ animated: false })}>
                  {liveLog.length > 0 ? (
                    liveLog.map((e, i) => (
                      <Text key={i} selectable style={{ fontFamily: MONO, fontSize: 11, color: isErrorLine(e.message) ? theme.red : theme.text }}>
                        <Text style={{ color: theme.secondary }}>{formatClock(e.timestamp)}  </Text>
                        {e.message}
                      </Text>
                    ))
                  ) : (
                    <Text selectable style={{ fontFamily: MONO, fontSize: 11, color: theme.text }}>
                      {result?.log ?? ""}
                    </Text>
                  )}
                </ScrollView>
              )}
              {tailing ? (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <ActivityIndicator size="small" />
                  <Caption>Waiting for logs…</Caption>
                </View>
              ) : null}
            </View>
          </Section>
        ) : null}
        {error ? (
          <Section title="Result">
            <View style={{ flexDirection: "row", gap: 8, padding: 12, alignItems: "center" }}>
              <Icon name="exclamationmark.triangle" color={theme.red} size={16} />
              <Text style={{ flex: 1, color: theme.red, fontSize: 15 }}>{error}</Text>
            </View>
          </Section>
        ) : null}
        {result ? (
          <Section title="Response">
            <View style={{ flexDirection: "row", gap: 8, padding: 12, alignItems: "center" }}>
              <Icon name={result.isError ? "xmark.octagon.fill" : "checkmark.circle.fill"} color={result.isError ? theme.red : theme.green} size={16} />
              <Text style={{ color: result.isError ? theme.red : theme.green, fontSize: 17 }}>{result.status}</Text>
            </View>
            <CodeBlock text={prettyJsonString(result.response)} />
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
