"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Panel>
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong loading this page"
        description={`Please try again. If it keeps happening, share this reference with support: ${error.digest ?? "n/a"}`}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Panel>
  );
}
