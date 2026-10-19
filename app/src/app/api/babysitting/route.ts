import { NextResponse } from "next/server";
import { babysittingEnabled } from "@/lib/features/flags";

export async function GET() {
  // 5c (P-23): 404 while BABYSITTING_ENABLED is off.
  if (!babysittingEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ message: "Babysitting API" });
}
