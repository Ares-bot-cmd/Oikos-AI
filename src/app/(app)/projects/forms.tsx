"use client";

import { Layers, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/form";
import {
  bulkUnitsAction, createProjectAction, createUnitAction, deleteProjectAction, updateProjectAction, updateUnitAction,
} from "./actions";

type Opt = { value: string; label: string };
type ProjectValues = Partial<Record<string, string | number | null>>;

const STATUSES: Opt[] = [
  { value: "planning", label: "Planning" }, { value: "pre_launch", label: "Pre-launch" }, { value: "under_construction", label: "Under construction" },
  { value: "ready_to_move", label: "Ready to move" }, { value: "completed", label: "Completed" },
];
const TYPES = ["Apartment", "Villa", "Row house", "Plot", "Commercial", "Office", "Retail", "Mixed use"].map((t) => ({ value: t, label: t }));

function ProjectFields({ v }: { v?: ProjectValues }) {
  const val = (k: string) => (v?.[k] == null ? undefined : (v[k] as string | number));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Project name" name="name" required defaultValue={val("name")} className="sm:col-span-2" />
      <FormField label="Location" name="location" required defaultValue={val("location")} placeholder="Locality, area" />
      <FormField label="City" name="city" defaultValue={val("city")} />
      <FormField label="Developer" name="developer" defaultValue={val("developer")} />
      <FormField label="Property type" name="propertyType" as="select" required options={TYPES} defaultValue={val("propertyType")} />
      <FormField label="Status" name="status" as="select" required options={STATUSES} defaultValue={val("status") ?? "under_construction"} />
      <FormField label="Total planned units" name="totalUnits" type="number" defaultValue={val("totalUnits") ?? 0} inputProps={{ min: 0 }} />
      <FormField label="Price from (₹)" name="priceFrom" type="number" defaultValue={val("priceFrom")} inputProps={{ min: 0, step: 10000 }} />
      <FormField label="Price to (₹)" name="priceTo" type="number" defaultValue={val("priceTo")} inputProps={{ min: 0, step: 10000 }} />
      <FormField label="RERA number" name="reraNumber" defaultValue={val("reraNumber")} />
      <FormField label="Possession date" name="possessionDate" type="date" defaultValue={val("possessionDate")} />
      <FormField label="Amenities" name="amenities" defaultValue={val("amenities")} placeholder="Pool, gym, clubhouse…" className="sm:col-span-2" />
      <FormField label="Description" name="description" as="textarea" defaultValue={val("description")} className="sm:col-span-2" />
    </div>
  );
}

export function NewProjectButton({ label = "New project" }: { label?: string }) {
  return (
    <Dialog wide title="New project" trigger={(open) => <Button onClick={open}><Plus className="size-4" /> {label}</Button>}>
      <ActionForm action={createProjectAction} className="space-y-4">
        <ProjectFields />
        <div className="flex justify-end"><SubmitButton>Create project</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function EditProjectButton({ project }: { project: ProjectValues & { id: string } }) {
  return (
    <Dialog wide title="Edit project" trigger={(open) => <Button variant="secondary" onClick={open}><Pencil className="size-4" /> Edit</Button>}>
      <ActionForm action={updateProjectAction} resetOnSuccess={false} className="space-y-4">
        <input type="hidden" name="id" value={project.id} />
        <ProjectFields v={project} />
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function DeleteProjectButton({ id, name }: { id: string; name: string }) {
  return (
    <Dialog title="Delete project" trigger={(open) => <Button variant="danger" onClick={open}>Delete</Button>}>
      <ActionForm action={deleteProjectAction} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <p className="text-sm text-ink-2">Delete <strong>{name}</strong> and all of its units? Projects with bookings can&apos;t be deleted.</p>
        <div className="flex justify-end"><SubmitButton variant="danger">Delete project</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

function UnitFields({ projects, v }: { projects: Opt[]; v?: ProjectValues }) {
  const val = (k: string) => (v?.[k] == null ? undefined : (v[k] as string | number));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Project" name="projectId" as="select" required options={projects} defaultValue={val("projectId")} className="sm:col-span-2" />
      <FormField label="Tower / block" name="tower" defaultValue={val("tower")} placeholder="A" />
      <FormField label="Unit number" name="unitNumber" required defaultValue={val("unitNumber")} placeholder="1204" />
      <FormField label="Floor" name="floor" type="number" required defaultValue={val("floor")} />
      <FormField label="Configuration" name="configuration" required defaultValue={val("configuration")} placeholder="2BHK" />
      <FormField label="Carpet area (sq ft)" name="carpetArea" type="number" required defaultValue={val("carpetArea")} inputProps={{ min: 1, step: "0.01" }} />
      <FormField label="Price (₹)" name="price" type="number" required defaultValue={val("price")} inputProps={{ min: 1, step: 1000 }} />
      <FormField label="Facing" name="facing" defaultValue={val("facing")} placeholder="East" />
      <FormField label="Floor plan link (https)" name="floorPlanUrl" type="url" defaultValue={val("floorPlanUrl")} />
    </div>
  );
}

export function AddUnitButton({ projects, projectId }: { projects: Opt[]; projectId?: string }) {
  return (
    <Dialog wide title="Add unit" trigger={(open) => <Button variant="secondary" onClick={open} disabled={!projects.length}><Plus className="size-4" /> Add unit</Button>}>
      <ActionForm action={createUnitAction} className="space-y-4" resetOnSuccess={false}>
        <UnitFields projects={projects} v={{ projectId: projectId ?? null }} />
        <div className="flex justify-end"><SubmitButton>Add unit</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function EditUnitButton({ projects, unit }: { projects: Opt[]; unit: ProjectValues & { id: string } }) {
  return (
    <Dialog wide title="Edit unit" trigger={(open) => <Button size="sm" variant="ghost" onClick={open} aria-label="Edit unit"><Pencil className="size-3.5" /></Button>}>
      <ActionForm action={updateUnitAction} resetOnSuccess={false} className="space-y-4">
        <input type="hidden" name="id" value={unit.id} />
        <UnitFields projects={projects} v={unit} />
        <div className="flex justify-end"><SubmitButton>Save unit</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function BulkUnitsButton({ projects, projectId }: { projects: Opt[]; projectId?: string }) {
  return (
    <Dialog wide title="Generate units" description="Creates numbered units for a range of floors, e.g. 101–104 … 1201–1204. Existing numbers are skipped." trigger={(open) => <Button onClick={open} disabled={!projects.length}><Layers className="size-4" /> Generate units</Button>}>
      <ActionForm action={bulkUnitsAction} className="space-y-4" resetOnSuccess={false}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Project" name="projectId" as="select" required options={projects} defaultValue={projectId} className="sm:col-span-2" />
          <FormField label="Tower / block" name="tower" placeholder="A" />
          <FormField label="Configuration" name="configuration" required placeholder="2BHK" />
          <FormField label="From floor" name="floorFrom" type="number" required defaultValue={1} />
          <FormField label="To floor" name="floorTo" type="number" required defaultValue={10} />
          <FormField label="Units per floor" name="unitsPerFloor" type="number" required defaultValue={4} inputProps={{ min: 1, max: 50 }} />
          <FormField label="Carpet area (sq ft)" name="carpetArea" type="number" required inputProps={{ min: 1 }} />
          <FormField label="Base price (₹)" name="basePrice" type="number" required inputProps={{ min: 1, step: 10000 }} />
          <FormField label="Floor rise per floor (₹)" name="floorRise" type="number" defaultValue={0} inputProps={{ min: 0, step: 1000 }} />
        </div>
        <div className="flex justify-end"><SubmitButton pendingText="Generating…">Generate</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
