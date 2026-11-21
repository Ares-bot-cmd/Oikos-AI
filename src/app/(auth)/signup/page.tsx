import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function SignupPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-bold">Create your workspace</h1>
      <p className="mt-1 text-[13.5px] text-muted">Set up Oikos AI for your company. You&apos;ll be the organization admin.</p>
      <div className="mt-6">
        <SignupForm />
      </div>
      <p className="mt-6 text-[13.5px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-emerald hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
