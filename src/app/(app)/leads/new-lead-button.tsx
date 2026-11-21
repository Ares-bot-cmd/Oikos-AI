"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LeadForm, type LeadFormOptions } from "./lead-form";

export function NewLeadButton({ options, label = "New lead" }: { options: LeadFormOptions; label?: string }) {
  return (
    <Dialog
      wide
      title="New lead"
      description="Phone or email is required. We check for duplicates automatically."
      trigger={(open) => (
        <Button onClick={open}>
          <Plus className="size-4" /> {label}
        </Button>
      )}
    >
      <LeadForm options={options} />
    </Dialog>
  );
}
