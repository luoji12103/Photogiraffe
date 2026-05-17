import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";
  const { name } = await params;

  try {
    const res = await fetch(`${internalApiUrl}/api/feature/${name}`, {
      cache: "no-store",
      headers: {
        // This endpoint is public-readable (no JWT needed)
        Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      },
    });

    if (!res.ok) {
      // Feature not found → treat as disabled
      return NextResponse.json({ enabled: false }, { status: 200 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ enabled: false }, { status: 200 });
  }
}
