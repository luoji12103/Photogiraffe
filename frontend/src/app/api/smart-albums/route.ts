import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE =
  process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const res = await fetch(`${GO_CORE}/api/smart-albums`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const body = await req.text();
  const res = await fetch(`${GO_CORE}/api/smart-albums`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
