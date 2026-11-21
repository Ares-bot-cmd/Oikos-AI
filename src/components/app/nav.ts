import type { Permission } from "@/lib/auth/permissions";

export type NavItem = { href: string; label: string; icon: string; permission?: Permission };
export type NavSection = { title: string; items: NavItem[] };

export const NAV: NavSection[] = [
  { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" }] },
  {
    title: "Sales & CRM",
    items: [
      { href: "/leads", label: "Lead Management", icon: "Users" },
      { href: "/pipeline", label: "Lead Pipeline", icon: "Columns3" },
      { href: "/contacts", label: "Contacts", icon: "Contact" },
      { href: "/follow-ups", label: "Follow-ups", icon: "PhoneCall" },
      { href: "/site-visits", label: "Site Visits", icon: "MapPin" },
      { href: "/team", label: "Sales Team", icon: "Trophy" },
    ],
  },
  {
    title: "Property Management",
    items: [
      { href: "/projects", label: "Projects", icon: "Building2" },
      { href: "/inventory", label: "Inventory", icon: "LayoutGrid" },
      { href: "/bookings", label: "Bookings", icon: "FileSignature" },
      { href: "/payments", label: "Payments", icon: "Wallet" },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/marketing", label: "Marketing Intelligence", icon: "Megaphone", permission: "marketing:read" },
      { href: "/revenue", label: "Revenue Intelligence", icon: "TrendingUp", permission: "revenue:read" },
      { href: "/insights", label: "AI Insights", icon: "Sparkles" },
      { href: "/reports", label: "Reports", icon: "FileBarChart", permission: "reports:read" },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/whatsapp", label: "WhatsApp Agent", icon: "MessageCircle", permission: "whatsapp:send" },
      { href: "/automation", label: "Workflow Automation", icon: "Workflow", permission: "automation:manage" },
      { href: "/notifications", label: "Notifications", icon: "Bell" },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/settings/organization", label: "Organization", icon: "Building", permission: "org:manage" },
      { href: "/settings/users", label: "Users & Roles", icon: "UserCog", permission: "users:manage" },
      { href: "/settings/integrations", label: "Integrations", icon: "Plug", permission: "integrations:manage" },
      { href: "/settings/billing", label: "Billing", icon: "CreditCard", permission: "billing:manage" },
      { href: "/settings/security", label: "Security", icon: "ShieldCheck" },
    ],
  },
];
