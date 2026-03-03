import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE = process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? "";
}

/** PUT /api/notifications/[id] — mark as read */
export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = await getToken();
  const res = await fetch(`${GO_CORE}/api/notifications/${id}/read`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** DELETE /api/notifications/[id] — delete notification */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = await getToken();
  const res = await fetch(`${GO_CORE}/api/notifications/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
