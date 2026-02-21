import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Forward the multipart form to go-core, injecting the server-side token.
    // The token is never sent to the browser.
    const res = await fetch(`${INTERNAL_API_URL}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: formData,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Upload proxy error:", error);
    return NextResponse.json(
      { error: "Upload failed due to an internal error." },
      { status: 502 }
    );
  }
}
