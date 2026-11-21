import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicForm } from "@/lib/services/capture";
import { LogoMark } from "@/components/app/logo";
import { PublicLeadForm } from "./public-form";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const form = await publicForm((await params).slug);
  return { title: form ? `${form.title} · ${form.orgName}` : "Form not found", robots: { index: false } };
}

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await publicForm(slug);
  if (!form) notFound();
  return (
    <main className="flex min-h-dvh items-start justify-center bg-ivory px-4 py-10 sm:py-16">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-card">
        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">{form.orgName}</div>
        <h1 className="text-xl font-bold">{form.title}</h1>
        {form.intro && <p className="mt-1 text-[13.5px] text-ink-2">{form.intro}</p>}
        {form.projectName && <p className="mt-1 text-[13px] text-muted">Project: {form.projectName}</p>}
        <div className="mt-5"><PublicLeadForm slug={slug} /></div>
        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-muted"><LogoMark className="size-4" /> Secured by Oikos AI. Your details are shared only with {form.orgName}.</p>
      </div>
    </main>
  );
}
