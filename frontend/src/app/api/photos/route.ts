import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  // Forward all query params (page, limit, search, status) to Go Core
  const { searchParams } = new URL(request.url);
  const queryString = searchParams.toString();
  const upstreamUrl = `${internalApiUrl}/photos${queryString ? `?${queryString}` : ""}`;

  try {
    const res = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to fetch photos" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching photos:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
