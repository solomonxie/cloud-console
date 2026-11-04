// The page a service row pushes to — one list per implemented resource kind.
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { resourceKinds, type ResourceKindId } from "@cloud-console/core/catalog";
import type { Bucket } from "@cloud-console/core/aws/s3-buckets";
import type { EC2Instance } from "@cloud-console/core/aws/ec2";
import type { LambdaFunctionSummary } from "@cloud-console/core/aws/lambda";
import type { IAMRole, IAMUser } from "@cloud-console/core/aws/iam";
import type { CVMInstance } from "@cloud-console/core/tencent/cvm";
import { cvmDetailFields } from "@cloud-console/core/tencent/cvm";
import type { SSMParameter } from "@cloud-console/core/aws/parameter-store";
import { isSecure } from "@cloud-console/core/aws/parameter-store";
import { eventBridgeItemId, type EventBridgeItem } from "@cloud-console/core/events";
import type { InstanceSummary } from "@cloud-console/core/gcp/compute";
import type { RunJobSummary, RunServiceSummary } from "@cloud-console/core/gcp/run";
import type { SecretSummary } from "@cloud-console/core/gcp/secrets";
import { fields } from "@cloud-console/core/detail";
import { formatDateTime } from "@cloud-console/core/format";
import { ProjectPicker } from "../../../src/components/ProjectPicker";
import { gceStatus, READY } from "../../../src/gcpLabels";
import * as cloud from "../../../src/services/cloud";
import { useLoad, useSession } from "../../../src/components/hooks";
import { ResourceRow } from "../../../src/components/ui";
import { ResourceList } from "../../../src/screens/ResourceList";
import { RegionalList } from "../../../src/screens/RegionalList";
import { BillingScreen } from "../../../src/screens/Billing";
import { KIND_ICON } from "../../../src/vendors";
import { VENDOR_ACCENT } from "../../../src/theme";
import { nav } from "../../../src/nav";

export default function KindScreen() {
  const { kind } = useLocalSearchParams<{ kind: ResourceKindId }>();
  const { connection, session } = useSession();
  if (!connection) return null;
  const meta = resourceKinds(connection.vendor, "mobile").find((k) => k.id === kind);
  // Unimplemented kinds are filtered out of the catalog, so never reachable.
  if (!meta) return null;
  const color = VENDOR_ACCENT[connection.vendor];
  const icon = KIND_ICON[meta.id];
  const id = connection.id;

  switch (meta.id) {
    case "billing":
      return <BillingScreen session={session} />;
    case "s3":
    case "cos":
    case "gcs":
      return <BucketList session={session} title={meta.title} icon={icon} color={color} service={meta.id} id={id} />;
    case "gceInstances":
      return <GCEList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "cloudRunServices":
      return <RunServiceList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "cloudRunJobs":
      return <RunJobList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "gcpSecrets":
      return <SecretList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "iamUsers":
    case "camUsers":
      return <UserList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "iamRoles":
    case "camRoles":
      return <RoleList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "ec2":
      return (
        <RegionalList<EC2Instance>
          session={session}
          title={meta.title}
          icon={icon}
          cacheKind="ec2-instances"
          fetch={cloud.listEC2}
          keyOf={(i) => i.instanceId}
          renderItem={(i, region) => (
            <ResourceRow icon="server.rack" color={color} title={i.name || i.instanceId} subtitle={`${i.instanceType} · ${i.state}`} onPress={() => nav.ec2(id, i, region)} />
          )}
        />
      );
    case "lambda":
      return (
        <RegionalList<LambdaFunctionSummary>
          session={session}
          title={meta.title}
          icon={icon}
          cacheKind="lambda-functions"
          fetch={cloud.listLambda}
          keyOf={(f) => f.name}
          renderItem={(f, region) => <ResourceRow icon="bolt.fill" color={color} title={f.name} subtitle={f.runtime} onPress={() => nav.lambda(id, f, region)} />}
        />
      );
    case "eventBridge":
      return (
        <RegionalList<EventBridgeItem>
          session={session}
          title={meta.title}
          icon={icon}
          cacheKind="eventbridge"
          fetch={cloud.listEventBridge}
          keyOf={eventBridgeItemId}
          renderItem={(item) => <EventRow item={item} color={color} onPress={() => nav.event(id, item)} />}
        />
      );
    case "tencentEventBridge":
      return <TencentEvents session={session} title={meta.title} icon={icon} color={color} id={id} />;
    case "parameterStore":
      return (
        <RegionalList<SSMParameter>
          session={session}
          title={meta.title}
          icon={icon}
          cacheKind="ssm-parameters"
          fetch={cloud.listParameters}
          keyOf={(p) => `${p.region}|${p.name}`}
          renderItem={(p) => (
            <ResourceRow
              icon={isSecure(p) ? "lock.fill" : "slider.horizontal.3"}
              color={color}
              title={p.name}
              subtitle={[p.type, p.version !== undefined ? `v${p.version}` : undefined, p.description || undefined].filter(Boolean).join(" · ")}
              onPress={() => nav.parameter(id, p)}
            />
          )}
        />
      );
    case "cvm":
      return <CVMList session={session} title={meta.title} icon={icon} color={color} id={id} />;
    default:
      return null;
  }
}

type ListProps = { session?: cloud.Session; title: string; icon: string; color: string; id: string };

function BucketList({ service, ...p }: ListProps & { service: "s3" | "cos" | "gcs" }) {
  const data = useLoad<Bucket[]>(p.session, (s, force) => cloud.listBuckets(s, service, force));
  return (
    <ResourceList
      header={service === "gcs" ? <ProjectPicker session={p.session} connectionID={p.id} /> : undefined}
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(b) => b.name}
      renderItem={(b) => (
        <ResourceRow icon="archivebox.fill" color={p.color} title={b.name} subtitle={b.region} onPress={() => nav.bucket(p.id, service, b.name, b.region ?? (service === "s3" ? "us-east-1" : ""))} />
      )}
    />
  );
}

function UserList(p: ListProps) {
  const data = useLoad<IAMUser[]>(p.session, cloud.listIAMUsers);
  return (
    <ResourceList
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(u) => u.arn}
      renderItem={(u) => <ResourceRow icon="person.fill" color={p.color} title={u.userName} subtitle={u.arn} onPress={() => nav.principal(p.id, "user", u)} />}
    />
  );
}

function RoleList(p: ListProps) {
  const data = useLoad<IAMRole[]>(p.session, cloud.listIAMRoles);
  return (
    <ResourceList
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(r) => r.arn}
      renderItem={(r) => <ResourceRow icon="person.2.badge.key.fill" color={p.color} title={r.roleName} subtitle={r.arn} onPress={() => nav.principal(p.id, "role", r)} />}
    />
  );
}

function CVMList(p: ListProps) {
  const data = useLoad<CVMInstance[]>(p.session, cloud.listCVM);
  return (
    <ResourceList
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(i) => i.instanceId}
      renderItem={(i) => (
        <ResourceRow
          icon="server.rack"
          color={p.color}
          title={i.instanceName || i.instanceId}
          subtitle={`${i.instanceType} · ${i.state}`}
          onPress={() => nav.detail(p.id, i.instanceName || i.instanceId, cvmDetailFields(i))}
        />
      )}
    />
  );
}

function TencentEvents(p: ListProps) {
  const data = useLoad<EventBridgeItem[]>(p.session, cloud.listTencentEvents);
  return (
    <ResourceList
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={eventBridgeItemId}
      renderItem={(item) => <EventRow item={item} color={p.color} showRegion onPress={() => nav.event(p.id, item)} />}
    />
  );
}

function GCEList(p: ListProps) {
  const data = useLoad<InstanceSummary[]>(p.session, cloud.listGCE);
  return (
    <ResourceList
      header={<ProjectPicker session={p.session} connectionID={p.id} />}
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(i) => `${i.zoneName}/${i.name}`}
      renderItem={(i) => (
        <ResourceRow icon="server.rack" color={p.color} title={i.name} subtitle={`${i.machineTypeName} · ${gceStatus(i.status)} · ${i.zoneName}`} onPress={() => nav.gce(p.id, i)} />
      )}
    />
  );
}

function RunServiceList(p: ListProps) {
  const data = useLoad<RunServiceSummary[]>(p.session, cloud.listRunServices);
  return (
    <ResourceList
      header={<ProjectPicker session={p.session} connectionID={p.id} />}
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(x) => x.name}
      renderItem={(x) => (
        <ResourceRow
          icon="shippingbox.fill"
          color={p.color}
          title={x.serviceId}
          subtitle={`${READY[x.ready]} · ${x.region}`}
          onPress={() =>
            nav.detail(
              p.id,
              x.serviceId,
              fields([
                ["URL", x.uri],
                ["Status", READY[x.ready]],
                ["Region", x.region],
                ["Ingress", x.ingress?.replace(/^INGRESS_TRAFFIC_/, "").replace(/_/g, " ").toLowerCase()],
                ["Revision", x.latestReadyRevision?.split("/").pop()],
                ["Image", x.template?.containers?.[0]?.image],
                ["Updated", x.updateTime ? formatDateTime(x.updateTime) : undefined],
                ["Updated by", x.lastModifier],
              ])
            )
          }
        />
      )}
    />
  );
}

function RunJobList(p: ListProps) {
  const data = useLoad<RunJobSummary[]>(p.session, cloud.listRunJobs);
  return (
    <ResourceList
      header={<ProjectPicker session={p.session} connectionID={p.id} />}
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(x) => x.name}
      renderItem={(x) => <ResourceRow icon="play.rectangle.fill" color={p.color} title={x.jobId} subtitle={`${READY[x.ready]} · ${x.region}`} onPress={() => nav.runJob(p.id, x)} />}
    />
  );
}

function SecretList(p: ListProps) {
  const data = useLoad<SecretSummary[]>(p.session, cloud.listSecrets);
  return (
    <ResourceList
      header={<ProjectPicker session={p.session} connectionID={p.id} />}
      title={p.title}
      icon={p.icon}
      data={data}
      keyOf={(x) => x.name}
      renderItem={(x) => (
        <ResourceRow icon="key.fill" color={p.color} title={x.secretId} subtitle={x.createTime ? `Created ${formatDateTime(x.createTime)}` : undefined} onPress={() => nav.secret(p.id, x)} />
      )}
    />
  );
}

const KIND_ICONS: Record<EventBridgeItem["kind"], string> = { Rule: "arrow.triangle.branch", Schedule: "clock.fill", "Event bus": "tray.full.fill" };

function EventRow({ item, color, showRegion, onPress }: { item: EventBridgeItem; color: string; showRegion?: boolean; onPress: () => void }) {
  const parts: string[] = [item.kind];
  if (showRegion) parts.push(item.region);
  if (item.state) parts.push(item.state.charAt(0) + item.state.slice(1).toLowerCase());
  if (item.summary) parts.push(item.summary);
  return <ResourceRow icon={KIND_ICONS[item.kind]} color={color} title={item.name} subtitle={parts.join(" · ")} onPress={onPress} />;
}
