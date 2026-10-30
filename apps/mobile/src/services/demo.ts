// Demo mode data: the same preset JSON the Swift app bundles (packages/demo).
import { DemoCloud } from "@cloud-console/core/demo/cloud";
import connections from "../../../../packages/demo/connections.json";
import aws from "../../../../packages/demo/aws.json";
import tencent from "../../../../packages/demo/tencent.json";

export const demo = new DemoCloud({ connections, aws, tencent });
