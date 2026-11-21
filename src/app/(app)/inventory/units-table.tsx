import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/app/bits";
import { InlineAction } from "@/components/ui/form";
import { formatMoney, formatNumber } from "@/lib/utils";
import { deleteUnitAction, markSoldAction, releaseUnitAction } from "../projects/actions";
import { EditUnitButton } from "../projects/forms";

export type UnitRow = {
  id: string; projectId: string; projectName: string; tower: string; unitNumber: string; floor: number; configuration: string; carpetArea: number;
  price: number; facing: string | null; floorPlanUrl: string | null; status: "available" | "reserved" | "booked" | "sold"; reservedFor: string | null;
  reservedForLeadId: string | null; reservedUntil: Date | null;
};

export function UnitsTable({ rows, currency, canWrite, canBook, projects, showProject = true, sortHeader }: {
  rows: UnitRow[]; currency: string; canWrite: boolean; canBook: boolean; projects: { value: string; label: string }[]; showProject?: boolean;
  sortHeader?: (label: string, field: string, className?: string) => React.ReactNode;
}) {
  const th = (label: string, field?: string, className = "") =>
    field && sortHeader ? sortHeader(label, field, className) : <th scope="col" className={`whitespace-nowrap px-4 py-2.5 font-medium ${className}`}>{label}</th>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left text-[13.5px]">
        <thead className="border-b border-line bg-ivory/60 text-xs text-muted">
          <tr>
            {showProject && th("Project")}
            {th("Unit", "unit")}
            {th("Floor", "floor")}
            {th("Configuration")}
            {th("Carpet area", "area", "text-right")}
            {th("Price", "price", "text-right")}
            {th("Status", "status")}
            {th("")}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-b border-line last:border-0 hover:bg-ivory/50">
              {showProject && <td className="px-4 py-2.5"><Link href={`/projects/${u.projectId}`} className="hover:underline">{u.projectName}</Link></td>}
              <td className="px-4 py-2.5 font-medium">
                {u.tower ? `${u.tower}-` : ""}{u.unitNumber}
                {u.floorPlanUrl && <a href={u.floorPlanUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-emerald hover:underline">plan <ExternalLink className="size-3" /></a>}
              </td>
              <td className="tnum px-4 py-2.5">{u.floor}</td>
              <td className="px-4 py-2.5">{u.configuration}{u.facing && <span className="text-xs text-muted"> · {u.facing}</span>}</td>
              <td className="tnum px-4 py-2.5 text-right">{formatNumber(u.carpetArea)} ft²</td>
              <td className="tnum px-4 py-2.5 text-right">{formatMoney(u.price, currency, true)}<div className="text-xs text-muted">{formatMoney(u.price / u.carpetArea, currency)}/ft²</div></td>
              <td className="px-4 py-2.5">
                <StatusBadge status={u.status} />
                {u.status === "reserved" && u.reservedFor && (
                  <div className="text-xs text-muted">for <Link href={`/leads/${u.reservedForLeadId}`} className="hover:underline">{u.reservedFor}</Link>{u.reservedUntil && ` until ${u.reservedUntil.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}</div>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="flex justify-end gap-1">
                  {canBook && u.status === "reserved" && <InlineAction action={releaseUnitAction} fields={{ id: u.id }} variant="ghost" confirm="Release this reservation?">Release</InlineAction>}
                  {canBook && u.status === "booked" && <InlineAction action={markSoldAction} fields={{ id: u.id }} variant="ghost" confirm="Mark this unit as sold (registration completed)?">Mark sold</InlineAction>}
                  {canWrite && <EditUnitButton projects={projects} unit={{ ...u, tower: u.tower, reservedUntil: null } as never} />}
                  {canWrite && u.status === "available" && <InlineAction action={deleteUnitAction} fields={{ id: u.id }} variant="ghost" confirm="Delete this unit?">Delete</InlineAction>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
