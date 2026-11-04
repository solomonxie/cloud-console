// Cloud Run job: details, last execution, and Run now.
import React, { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { RunJobSummary } from "@cloud-console/core/gcp/run";
import { fields } from "@cloud-console/core/detail";
import { formatDateTime } from "@cloud-console/core/format";
import { errorMessage } from "@cloud-console/core/aws/errors";
import * as cloud from "../../../src/services/cloud";
import { useJsonParam, useSession } from "../../../src/components/hooks";
import { DetailRow, LinkRow, Muted, Screen, Section } from "../../../src/components/ui";
import { READY } from "../../../src/gcpLabels";

const outcome = (s?: string) => s?.replace(/^EXECUTION_/, "").toLowerCase();

export default function RunJobDetail() {
  const job = useJsonParam<RunJobSummary>("job");
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  if (!job) return null;
  const last = job.latestCreatedExecution;

  const runNow = () =>
    Alert.alert(`Run ${job.jobId}?`, "Starts a new execution with the job's saved configuration.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Run",
        onPress: async () => {
          if (!session) return;
          setBusy(true);
          setNote(undefined);
          try {
            await cloud.runJob(session, job);
            setNote("Execution started.");
          } catch (e) {
            setNote(errorMessage(e));
          }
          setBusy(false);
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: job.jobId }} />
      <Screen>
        <Section title="Details">
          {fields([
            ["Status", READY[job.ready]],
            ["Region", job.region],
            ["Executions", job.executionCount],
            ["Image", job.template?.template?.containers?.[0]?.image],
            ["Tasks", job.template?.taskCount],
            ["Updated", job.updateTime ? formatDateTime(job.updateTime) : undefined],
          ]).map((f) => (
            <DetailRow key={f.label} label={f.label} value={f.value} />
          ))}
        </Section>
        {last ? (
          <Section title="Last execution">
            {fields([
              ["Started", last.createTime ? formatDateTime(last.createTime) : undefined],
              ["Finished", last.completionTime ? formatDateTime(last.completionTime) : undefined],
              ["Result", outcome(last.completionStatus) ?? "running"],
            ]).map((f) => (
              <DetailRow key={f.label} label={f.label} value={f.value} />
            ))}
          </Section>
        ) : null}
        <Section footer="Needs Cloud Run Invoker or Developer on this job.">
          <LinkRow label="Run now" icon="play.fill" disabled={busy} onPress={runNow} />
          {note ? <Muted>{note}</Muted> : null}
        </Section>
      </Screen>
    </>
  );
}
