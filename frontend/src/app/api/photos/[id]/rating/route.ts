import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE = process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const body = await req.json();
  const res = await fetch(`${GO_CORE}/api/photos/${id}/rating`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
