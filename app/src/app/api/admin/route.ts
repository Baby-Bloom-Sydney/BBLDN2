import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.error === "Not authenticated" ? 401 : 403 },
    );
  }
  return NextResponse.json({ message: "Admin API" });
}
