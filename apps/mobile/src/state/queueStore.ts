import { useEffect, useState } from "react";
import type { StorageOperation } from "@cloud-console/core/operation-queue";
import { queue } from "../services/queue";

export function useOperations(): StorageOperation[] {
  const [ops, setOps] = useState<StorageOperation[]>(queue.all);
  useEffect(() => queue.subscribe(setOps), []);
  return ops;
}
