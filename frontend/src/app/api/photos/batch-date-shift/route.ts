import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE = process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? "";
}

/** POST /api/photos/batch-date-shift */
export async function POST(req: NextRequest) {
  const token = await getToken();
  const body = await req.json();
  const res = await fetch(`${GO_CORE}/api/photos/batch-date-shift`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
