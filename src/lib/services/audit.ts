import "server-only";
import type { Tx } from "@/lib/db";
import type { TenantCtx } from "@/lib/db/tenant";
import { auditLogs } from "@/lib/db/schema";

export async function audit(
  tx: Tx,
  ctx: TenantCtx,
  action: string,
  entity?: { type: string; id?: string | null },
  details?: Record<string, unknown>,
  ip?: string,
) {
  await tx.insert(auditLogs).values({
    organizationId: ctx.orgId,
    userId: ctx.userId,
    action,
    entityType: entity?.type,
    entityId: entity?.id ?? null,
    details,
    ip,
  });
}
