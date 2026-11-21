import type { Metadata } from "next";
import Link from "next/link";
import { findInvitation } from "@/lib/services/accounts";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { InviteForms } from "./invite-forms";

export const metadata: Metadata = { title: "Join your team" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const inv = token.length <= 200 ? await findInvitation(token) : null;
  if (!inv) {
    return (
      <>
        <h1 className="text-2xl font-bold">Invitation unavailable</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          This invitation link is invalid, already used, or has expired. Ask your administrator to send a new one.
        </p>
        <Link href="/login" className="mt-6 inline-block font-medium text-emerald hover:underline">
          Go to sign in
        </Link>
      </>
    );
  }
  const session = await getSession();
  return (
    <>
      <h1 className="text-2xl font-bold">Join {inv.orgName}</h1>
      <p className="mt-1 text-[13.5px] text-muted">
        You&apos;ve been invited as <strong className="text-ink">{ROLE_LABELS[inv.role]}</strong> ({inv.email}).
      </p>
      <div className="mt-6">
        <InviteForms token={token} defaultName={inv.name ?? ""} signedInAs={session?.email ?? null} />
      </div>
    </>
  );
}
