import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE =
  process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const { searchParams } = new URL(req.url);
  const query = searchParams.toString();
  const res = await fetch(
    `${GO_CORE}/api/smart-albums/${id}/photos${query ? `?${query}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
