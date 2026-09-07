import type { EntityCollection, PendingMutation } from "./types";

export function mergeCollectionWithPending<T extends { id: string }>(
  collection: EntityCollection,
  remoteItems: T[],
  localItems: T[],
  pending: PendingMutation[]
): T[] {
  const map = new Map(remoteItems.map((item) => [item.id, item]));
  pending.filter((mutation) => mutation.collection === collection).forEach((mutation) => {
    if (mutation.action === "delete") {
      map.delete(mutation.entityId);
      return;
    }
    const local = localItems.find((item) => item.id === mutation.entityId);
    if (local) map.set(local.id, local);
  });
  return Array.from(map.values());
}
