import { type NextRequest, NextResponse } from "next/server";

const GO_CORE = process.env.NEXT_PUBLIC_API_URL ?? "http://go-core:8080";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = req.headers.get("Authorization") ?? "";
  const res = await fetch(`${GO_CORE}/api/photos/${id}/iptc`, {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = req.headers.get("Authorization") ?? "";
  const body = await req.json();
  const res = await fetch(`${GO_CORE}/api/photos/${id}/iptc`, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
