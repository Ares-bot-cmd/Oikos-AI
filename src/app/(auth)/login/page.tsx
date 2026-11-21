import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/dashboard");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <>
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-1 text-[13.5px] text-muted">Welcome back. Sign in to your workspace.</p>
      <div className="mt-6">
        <LoginForm next={next} />
      </div>
      <p className="mt-6 text-[13.5px] text-muted">
        New to Oikos AI?{" "}
        <Link href="/signup" className="font-medium text-emerald hover:underline">
          Create a workspace
        </Link>
      </p>
    </>
  );
}
