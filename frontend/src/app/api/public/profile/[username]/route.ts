import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  try {
    const res = await fetch(
      `${INTERNAL_API}/public/profile/${encodeURIComponent(username)}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("public profile proxy error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 502 });
  }
}
