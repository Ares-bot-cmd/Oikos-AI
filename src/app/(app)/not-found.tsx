import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <Panel>
      <EmptyState icon={SearchX} title="Not found" description="This record doesn't exist or you don't have access to it." action={<LinkButton href="/dashboard">Back to dashboard</LinkButton>} />
    </Panel>
  );
}
