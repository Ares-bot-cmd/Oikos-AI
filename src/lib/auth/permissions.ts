export const ROLES = ["org_admin", "sales_manager", "sales_executive", "marketing_manager"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  org_admin: "Organization Admin",
  sales_manager: "Sales Manager",
  sales_executive: "Sales Executive",
  marketing_manager: "Marketing Manager",
};

export type Permission =
  | "leads:read_all" // see every lead (executives only see leads they own)
  | "leads:write"
  | "leads:assign"
  | "leads:import"
  | "leads:export"
  | "leads:delete"
  | "projects:write"
  | "bookings:write"
  | "payments:write"
  | "marketing:read"
  | "marketing:write"
  | "revenue:read"
  | "team:read"
  | "team:manage"
  | "reports:read"
  | "automation:manage"
  | "whatsapp:send"
  | "integrations:manage"
  | "org:manage"
  | "users:manage"
  | "billing:manage"
  | "audit:read";

const ALL: Permission[] = [
  "leads:read_all", "leads:write", "leads:assign", "leads:import", "leads:export", "leads:delete",
  "projects:write", "bookings:write", "payments:write", "marketing:read", "marketing:write",
  "revenue:read", "team:read", "team:manage", "reports:read", "automation:manage", "whatsapp:send",
  "integrations:manage", "org:manage", "users:manage", "billing:manage", "audit:read",
];

const MATRIX: Record<Role, Permission[]> = {
  org_admin: ALL,
  sales_manager: [
    "leads:read_all", "leads:write", "leads:assign", "leads:import", "leads:export",
    "projects:write", "bookings:write", "payments:write", "marketing:read", "revenue:read",
    "team:read", "team:manage", "reports:read", "automation:manage", "whatsapp:send",
  ],
  sales_executive: ["leads:write", "bookings:write", "whatsapp:send"],
  marketing_manager: [
    "leads:read_all", "leads:write", "leads:import", "leads:export", "marketing:read",
    "marketing:write", "revenue:read", "reports:read", "integrations:manage",
  ],
};

export function can(role: Role | "system", permission: Permission): boolean {
  if (role === "system") return true;
  return MATRIX[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | "system", permission: Permission) {
  if (!can(role, permission)) throw new ForbiddenError();
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
