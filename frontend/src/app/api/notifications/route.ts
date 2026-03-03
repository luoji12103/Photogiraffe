import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE = process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? "";
}

/** GET /api/notifications — list notifications */
export async function GET(req: NextRequest) {
  const token = await getToken();
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const res = await fetch(`${GO_CORE}/api/notifications${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** PUT /api/notifications — mark all as read */
export async function PUT() {
  const token = await getToken();
  const res = await fetch(`${GO_CORE}/api/notifications/read-all`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
