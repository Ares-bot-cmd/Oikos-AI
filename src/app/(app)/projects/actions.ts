"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, type ActionState } from "@/lib/actions";
import { tenantAction } from "@/lib/server-action";
import { flash } from "@/lib/flash";
import {
  bulkCreateUnits, createProject, createUnit, deleteProject, deleteUnit, markUnitSold, releaseUnit, updateProject, updateUnit,
} from "@/lib/services/projects";

type Obj = Record<string, string | undefined>;
const projectInput = (d: Obj) => ({
  name: d.name ?? "", location: d.location ?? "", city: d.city, developer: d.developer, propertyType: d.propertyType ?? "",
  status: (d.status ?? "under_construction") as "planning", totalUnits: d.totalUnits as unknown as number,
  priceFrom: d.priceFrom as unknown as number, priceTo: d.priceTo as unknown as number, reraNumber: d.reraNumber,
  possessionDate: d.possessionDate, description: d.description, amenities: d.amenities,
});
const unitInput = (d: Obj) => ({
  projectId: d.projectId ?? "", tower: d.tower, unitNumber: d.unitNumber ?? "", floor: d.floor as unknown as number,
  configuration: d.configuration ?? "", carpetArea: d.carpetArea as unknown as number, price: d.price as unknown as number,
  facing: d.facing, floorPlanUrl: d.floorPlanUrl,
});

export async function createProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await tenantAction(async (tx, ctx) => {
    id = await createProject(tx, ctx, projectInput(formObject(fd)));
  });
  if (res?.ok && id) {
    await flash("Project created. Now add its units.");
    redirect(`/projects/${id}`);
  }
  return res;
}

export async function updateProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await updateProject(tx, ctx, z.uuid().parse(d.id), projectInput(d));
    return { ok: true, message: "Project saved." };
  });
}

export async function deleteProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await tenantAction(async (tx, ctx) => {
    await deleteProject(tx, ctx, z.uuid().parse(fd.get("id")));
  });
  if (res?.ok) {
    await flash("Project deleted.");
    redirect("/projects");
  }
  return res;
}

export async function createUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await createUnit(tx, ctx, unitInput(formObject(fd)));
    return { ok: true, message: "Unit added." };
  });
}

export async function bulkUnitsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    const r = await bulkCreateUnits(tx, ctx, {
      projectId: d.projectId ?? "", tower: d.tower, floorFrom: d.floorFrom as unknown as number, floorTo: d.floorTo as unknown as number,
      unitsPerFloor: d.unitsPerFloor as unknown as number, configuration: d.configuration ?? "", carpetArea: d.carpetArea as unknown as number,
      basePrice: d.basePrice as unknown as number, floorRise: (d.floorRise ?? "0") as unknown as number,
    });
    return { ok: true, message: `${r.created} units created${r.skipped ? `, ${r.skipped} already existed` : ""}.` };
  });
}

export async function updateUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return tenantAction(async (tx, ctx) => {
    await updateUnit(tx, ctx, z.uuid().parse(d.id), unitInput(d));
    return { ok: true, message: "Unit saved." };
  });
}

export async function deleteUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await deleteUnit(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Unit deleted." };
  });
}

export async function releaseUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await releaseUnit(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Reservation released." };
  });
}

export async function markSoldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (tx, ctx) => {
    await markUnitSold(tx, ctx, z.uuid().parse(fd.get("id")));
    return { ok: true, message: "Unit marked as sold." };
  });
}
