import { z } from "zod";

// Reusable zod field helpers
export const zText = (max = 200) => z.string().trim().max(max, `Must be ${max} characters or fewer`);
export const zRequired = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
export const zMoney = z.coerce
  .number({ error: "Enter a valid amount" })
  .finite()
  .min(0, "Amount can't be negative")
  .max(1e13, "Amount is too large");
export const zOptMoney = zMoney.optional();
export const zUuid = z.uuid({ error: "Invalid selection" });
export const zOptUuid = zUuid.optional();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
export const zDateTime = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Enter a valid date and time");
