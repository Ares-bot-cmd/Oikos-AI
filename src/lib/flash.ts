import "server-only";
import { cookies } from "next/headers";

/** Queues a toast to show after the next navigation (read and cleared by <Toaster/>). */
export async function flash(message: string, tone: "success" | "error" = "success") {
  (await cookies()).set("oikos_flash", encodeURIComponent(JSON.stringify({ m: message, t: tone })), {
    path: "/",
    maxAge: 30,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}
