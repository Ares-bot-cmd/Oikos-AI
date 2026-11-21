"use server";

import { z } from "zod";
import type { ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { markRead } from "@/lib/services/notifications";

export async function markReadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, _ctx, session) => {
    await markRead(tx, session.userId, z.uuid().parse(fd.get("id")));
  });
}

export async function markAllReadAction(): Promise<ActionState> {
  return tenantAction(async (tx, _ctx, session) => {
    await markRead(tx, session.userId);
    return { ok: true, message: "All notifications marked as read." };
  });
}
