import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE = process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const res = await fetch(`${GO_CORE}/api/tags/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
