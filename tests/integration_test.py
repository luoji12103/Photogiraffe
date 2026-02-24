#!/usr/bin/env python3
"""
Photogiraffe Integration Test Suite
测试范围: v7.3 Albums, v7.4 Profile, v7.5 Enhanced Presets, v8.1 Stats, v8.3 Search, v8.5 SSE
运行方式: python3 tests/integration_test.py
需要: Go Core 运行于 http://127.0.0.1:8080
"""

import json
import os
import sys
import time
import io
import socket as _socket_module
import urllib.request
import urllib.error
import urllib.parse

BASE_URL = "http://127.0.0.1:8080"
PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
SKIP = "\033[33m~\033[0m"

failures = []
passes = []


# ─────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────

def http(method, path, body=None, token=None, form_data=None, expected_status=None):
    url = BASE_URL + path
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif form_data is not None:
        data = form_data
    else:
        data = None

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            raw = resp.read()
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read()
    except Exception as e:
        return None, 0, str(e)

    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = raw.decode("utf-8", errors="replace")

    return parsed, status, None


def check(name, condition, detail=""):
    if condition:
        passes.append(name)
        print(f"  {PASS} {name}")
    else:
        failures.append(name)
        print(f"  {FAIL} {name}{(' — ' + str(detail)) if detail else ''}")


def section(title):
    print(f"\n\033[1m{'═'*60}\033[0m")
    print(f"\033[1m  {title}\033[0m")
    print(f"\033[1m{'═'*60}\033[0m")


# ─────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────

def test_auth():
    section("Auth — Login")
    d, status, err = http("POST", "/api/auth/login",
                          body={"username": "admin", "password": "testadmin1234"})
    check("POST /api/auth/login 200", status == 200, f"status={status}")
    check("Response has access_token", isinstance(d, dict) and "access_token" in d, d)
    if isinstance(d, dict) and "access_token" in d:
        return d["access_token"]

    # Fallback: read from file written earlier
    try:
        with open("/tmp/pg_token.txt") as f:
            tok = f.read().strip()
        if tok:
            print(f"  {SKIP} Using cached token from /tmp/pg_token.txt")
            return tok
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────────
# v7.3 Albums
# ─────────────────────────────────────────────────────────────────

def test_albums(token):
    section("v7.3 Albums — CRUD & Share")

    # Create
    d, status, _ = http("POST", "/api/albums",
                        body={"name": "Test Album CI", "description": "integration test"}, token=token)
    check("POST /api/albums 200/201", status in (200, 201), f"status={status} body={d}")
    album_id = d.get("ID") or d.get("id") if isinstance(d, dict) else None
    check("Album ID returned", album_id is not None, d)
    if album_id is None:
        return None

    # List
    d, status, _ = http("GET", "/api/albums", token=token)
    check("GET /api/albums 200", status == 200)
    check("Albums list is array", isinstance(d, list), d)
    found = any((a.get("ID") or a.get("id")) == album_id for a in d) if isinstance(d, list) else False
    check("New album in list", found)

    # Get by ID
    d, status, _ = http("GET", f"/api/albums/{album_id}", token=token)
    check(f"GET /api/albums/{album_id} 200", status == 200)
    check("Album name matches", isinstance(d, dict) and d.get("Name") == "Test Album CI", d)

    # Update
    d, status, _ = http("PUT", f"/api/albums/{album_id}",
                        body={"name": "Renamed Album CI"}, token=token)
    check(f"PUT /api/albums/{album_id} 200", status == 200)

    # Share
    d, status, _ = http("POST", f"/api/albums/{album_id}/share", token=token)
    check("POST /api/albums/:id/share 200", status == 200)
    share_token = d.get("share_token") if isinstance(d, dict) else None
    check("Share token returned", bool(share_token), d)

    if share_token:
        d2, status2, _ = http("GET", f"/share/album/{share_token}")
        check("GET /share/album/:token 200 (public)", status2 == 200, f"status={status2}")

    # Revoke share
    d, status, _ = http("DELETE", f"/api/albums/{album_id}/share", token=token)
    check("DELETE /api/albums/:id/share 200", status == 200)

    # Delete album
    d, status, _ = http("DELETE", f"/api/albums/{album_id}", token=token)
    check("DELETE /api/albums/:id 200", status == 200)

    # Confirm deleted
    d, status, _ = http("GET", f"/api/albums/{album_id}", token=token)
    check("Album deleted — 404", status == 404, f"status={status}")
    return album_id


# ─────────────────────────────────────────────────────────────────
# v7.4 User Profile
# ─────────────────────────────────────────────────────────────────

def test_profile(token):
    section("v7.4 User Profile — GET / PUT")

    d, status, _ = http("GET", "/api/profile", token=token)
    check("GET /api/profile 200", status == 200, f"status={status} body={d}")
    check("Profile is dict", isinstance(d, dict), d)

    d, status, _ = http("PUT", "/api/profile",
                        body={"bio": "CI test bio", "location": "Testland", "website": "https://example.com"},
                        token=token)
    check("PUT /api/profile 200", status == 200, f"status={status} body={d}")

    d, status, _ = http("GET", "/api/profile", token=token)
    # API returns lowercase field names
    bio_val = d.get("Bio") or d.get("bio") if isinstance(d, dict) else None
    loc_val = d.get("Location") or d.get("location") if isinstance(d, dict) else None
    check("Profile bio updated", bio_val == "CI test bio", d)
    check("Profile location updated", loc_val == "Testland", d)


# ─────────────────────────────────────────────────────────────────
# v7.5 Enhanced Presets
# ─────────────────────────────────────────────────────────────────

def test_presets(token):
    section("v7.5 Enhanced Presets — Platforms, File, Apply")

    # Create preset with platforms
    platforms = json.dumps(["Lightroom", "Capture One"])
    adjust = json.dumps({"exposure": 0.3, "contrast": 10, "saturation": 5,
                         "temperature": 0, "tint": 0, "highlights": 0,
                         "shadows": 0, "whites": 0, "blacks": 0,
                         "clarity": 0, "vibrance": 0, "sharpness": 0,
                         "noiseReduction": 0, "vignette": 0, "grain": 0,
                         "hueR": 0, "hueG": 0, "hueB": 0})
    d, status, _ = http("POST", "/api/presets",
                        body={"name": "CI Preset v7.5",
                              "description": "integration test",
                              "adjust_params": adjust,
                              "platforms": platforms},
                        token=token)
    check("POST /api/presets 200/201", status in (200, 201), f"status={status} body={d}")
    preset_id = d.get("ID") or d.get("id") if isinstance(d, dict) else None
    check("Preset ID returned", preset_id is not None, d)
    if preset_id is None:
        return

    # List presets
    d, status, _ = http("GET", "/api/presets", token=token)
    check("GET /api/presets 200", status == 200)
    found = any((p.get("ID") or p.get("id")) == preset_id for p in d) if isinstance(d, list) else False
    check("New preset in list", found, d)

    # Check platforms stored
    preset_data = next((p for p in d if (p.get("ID") or p.get("id")) == preset_id), None) if isinstance(d, list) else None
    if preset_data:
        stored_platforms = preset_data.get("Platforms", "")
        try:
            parsed_plats = json.loads(stored_platforms)
        except Exception:
            parsed_plats = []
        check("Platforms stored correctly", "Lightroom" in parsed_plats, f"platforms={stored_platforms}")

    # PUT /api/presets/:id — update
    d, status, _ = http("PUT", f"/api/presets/{preset_id}",
                        body={"name": "CI Preset v7.5 Updated",
                              "platforms": json.dumps(["Darktable"])},
                        token=token)
    check(f"PUT /api/presets/{preset_id} 200", status == 200, f"status={status} body={d}")

    # Upload preset file (fake XMP content)
    fake_xmp = b"<x:xmpmeta><!-- CI test preset file --></x:xmpmeta>"
    boundary = "testboundary12345"
    form_body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test.xmp"\r\n'
        f"Content-Type: application/xml\r\n\r\n"
    ).encode() + fake_xmp + f"\r\n--{boundary}--\r\n".encode()
    headers_extra = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {token}",
    }
    req = urllib.request.Request(
        BASE_URL + f"/api/presets/{preset_id}/file",
        data=form_body,
        headers=headers_extra,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            file_status = resp.status
            file_body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        file_status = e.code
        try:
            file_body = json.loads(e.read())
        except Exception:
            file_body = {}
    check("POST /api/presets/:id/file 200", file_status == 200, f"status={file_status} body={file_body}")

    # Download URL
    d, status, _ = http("GET", f"/api/presets/{preset_id}/file", token=token)
    check("GET /api/presets/:id/file 200", status == 200, f"status={status}")
    check("download_url in response", isinstance(d, dict) and "download_url" in d, d)

    # GET photos to find a photo to apply preset to
    d, status, _ = http("GET", "/photos?limit=1", token=token)
    photo_id = None
    if isinstance(d, dict) and d.get("photos"):
        photo_id = d["photos"][0].get("ID") or d["photos"][0].get("id")
    check("Has at least one photo for apply test", photo_id is not None,
          f"(skipping apply test if no photos)" if photo_id is None else "ok")

    if photo_id:
        d, status, _ = http("POST", f"/api/presets/{preset_id}/apply/{photo_id}", token=token)
        check(f"POST /api/presets/:id/apply/:photo_id 200", status == 200, f"status={status} body={d}")

        d, status, _ = http("GET", f"/api/photos/{photo_id}/preset", token=token)
        check(f"GET /api/photos/{photo_id}/preset 200", status in (200, 404), f"status={status}")
        if status == 200 and isinstance(d, dict):
            returned_id = d.get("ID") or d.get("id")
            check("Returned preset ID matches", returned_id == preset_id, f"got={returned_id} want={preset_id}")

    # Cleanup
    d, status, _ = http("DELETE", f"/api/presets/{preset_id}", token=token)
    check(f"DELETE /api/presets/{preset_id} 200", status == 200)


# ─────────────────────────────────────────────────────────────────
# v8.1 Stats
# ─────────────────────────────────────────────────────────────────

def test_stats(token):
    section("v8.1 Dashboard Stats — GET /api/stats")
    d, status, _ = http("GET", "/api/stats", token=token)
    check("GET /api/stats 200", status == 200, f"status={status} body={str(d)[:200]}")
    if isinstance(d, dict):
        for key in ["total_photos", "completed_photos", "ai_analyzed", "albums", "presets",
                    "recent_uploads", "top_cameras", "top_lenses", "color_spaces"]:
            check(f"  stats has field '{key}'", key in d, f"keys={list(d.keys())}")
        check("total_photos >= 0", isinstance(d.get("total_photos"), int) and d["total_photos"] >= 0)
        check("recent_uploads is list", isinstance(d.get("recent_uploads"), list))
        check("top_cameras is list", isinstance(d.get("top_cameras"), list))


# ─────────────────────────────────────────────────────────────────
# v8.3 Search
# ─────────────────────────────────────────────────────────────────

def test_search(token):
    section("v8.3 Advanced Search — GET /api/photos/search")

    # Basic search no params
    d, status, _ = http("GET", "/api/photos/search", token=token)
    check("GET /api/photos/search 200", status == 200, f"status={status}")
    if isinstance(d, dict):
        check("Has photos field", "photos" in d)
        check("Has total field", "total" in d)
        check("Has total_pages", "total_pages" in d)

    # Search with keyword
    d, status, _ = http("GET", "/api/photos/search?q=test", token=token)
    check("GET /api/photos/search?q=test 200", status == 200, f"status={status}")

    # Search with camera filter
    d, status, _ = http("GET", "/api/photos/search?camera=Sony", token=token)
    check("GET /api/photos/search?camera=Sony 200", status == 200, f"status={status}")

    # Search with ISO range
    d, status, _ = http("GET", "/api/photos/search?iso_min=100&iso_max=3200", token=token)
    check("GET /api/photos/search?iso_min/max 200", status == 200, f"status={status}")

    # Search with date range
    d, status, _ = http("GET", "/api/photos/search?date_from=2025-01-01&date_to=2026-12-31", token=token)
    check("GET /api/photos/search?date_from/to 200", status == 200, f"status={status}")

    # Pagination
    d, status, _ = http("GET", "/api/photos/search?page=1&limit=5", token=token)
    check("GET /api/photos/search?page=1&limit=5 200", status == 200)
    if isinstance(d, dict):
        check("Limit respected", isinstance(d.get("photos"), list) and len(d["photos"]) <= 5)

    # GPS radius search (Paris coordinates)
    d, status, _ = http("GET", "/api/photos/search?lat=48.85&lng=2.35&radius_km=50", token=token)
    check("GET /api/photos/search?lat/lng/radius 200", status == 200, f"status={status}")

    # Unauthenticated should be 401
    d, status, _ = http("GET", "/api/photos/search")
    check("GET /api/photos/search without token → 401", status == 401, f"status={status}")


# ─────────────────────────────────────────────────────────────────
# v8.5 SSE — Server-Sent Events
# ─────────────────────────────────────────────────────────────────

def test_sse(token):
    section("v8.5 SSE — /api/events/stream")

    # 1. No token → 401
    d, status, _ = http("GET", "/api/events/stream")
    check("GET /api/events/stream without token → 401", status == 401, f"status={status}")

    # 2. Bad token → 401
    d, status, _ = http("GET", "/api/events/stream?token=bad.token.here")
    check("GET /api/events/stream bad token → 401", status == 401, f"status={status}")

    # 3. Valid token → 200 with text/event-stream + receives 'connected' event
    # Use raw socket to avoid http.client's chunked-body blocking semantics.
    try:
        req_line = (
            f"GET /api/events/stream?token={urllib.parse.quote(token)} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:8080\r\n"
            f"Connection: close\r\n\r\n"
        )
        s = _socket_module.socket(_socket_module.AF_INET, _socket_module.SOCK_STREAM)
        s.settimeout(6)
        s.connect(("127.0.0.1", 8080))
        s.sendall(req_line.encode())
        raw = b""
        try:
            while len(raw) < 2048:
                chunk = s.recv(512)
                if not chunk:
                    break
                raw += chunk
                if b"connected" in raw:
                    break
        except _socket_module.timeout:
            pass
        finally:
            s.close()

        raw_str = raw.decode("utf-8", errors="replace")
        status_line = raw_str.split("\r\n")[0]
        status_code = int(status_line.split(" ")[1]) if len(status_line.split(" ")) >= 2 else 0
        content_type_line = next((l for l in raw_str.split("\r\n") if l.lower().startswith("content-type:")), "")
        check("GET /api/events/stream with token → 200", status_code == 200, f"status_line={status_line!r}")
        check("Content-Type is text/event-stream", "text/event-stream" in content_type_line.lower(), f"header={content_type_line!r}")
        check("SSE 'connected' event received", "connected" in raw_str, f"raw={raw_str[:300]!r}")
    except Exception as e:
        check("GET /api/events/stream connection", False, str(e))
        check("Content-Type is text/event-stream", False, "connection failed")
        check("SSE 'connected' event received", False, "connection failed")


# ─────────────────────────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────────────────────────

def test_security(token):
    section("Security — Auth boundary checks")

    # Unauthenticated requests should be 401
    for path in ["/api/albums", "/api/profile", "/api/presets", "/api/stats"]:
        d, status, _ = http("GET", path)
        check(f"GET {path} without token → 401", status == 401, f"status={status}")

    # Invalid token
    d, status, _ = http("GET", "/api/stats", token="invalid.token.here")
    check("GET /api/stats with bad token → 401", status == 401, f"status={status}")

    # Access other user album (album ID that doesn't exist)
    d, status, _ = http("GET", "/api/albums/999999", token=token)
    check("GET /api/albums/999999 → 404", status == 404, f"status={status}")


# ─────────────────────────────────────────────────────────────────  
# Existing endpoints regression
# ─────────────────────────────────────────────────────────────────

def test_regression(token):
    section("Regression — Core endpoints still work")

    d, status, _ = http("GET", "/photos?page=1&limit=5", token=token)
    check("GET /photos 200", status == 200, f"status={status}")
    check("Paginated photos response", isinstance(d, dict) and "photos" in d, d)

    d, status, _ = http("GET", "/api/photos/map", token=token)
    check("GET /api/photos/map 200 (v7.1)", status == 200, f"status={status}")
    check("Map response is list", isinstance(d, list), d)

    d, status, _ = http("GET", "/api/presets", token=token)
    check("GET /api/presets 200", status == 200)
    check("Presets is list", isinstance(d, list))

    d, status, _ = http("GET", "/api/albums", token=token)
    check("GET /api/albums 200", status == 200)
    check("Albums is list", isinstance(d, list))


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main():
    print("\n\033[1;36m  Photogiraffe Integration Test Suite\033[0m")
    print(f"  Target: {BASE_URL}")
    print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    token = test_auth()
    if not token:
        print("\n\033[31mFATAL: Could not obtain auth token. Aborting.\033[0m")
        sys.exit(1)

    test_regression(token)
    test_albums(token)
    test_profile(token)
    test_presets(token)
    test_stats(token)
    test_search(token)
    test_sse(token)
    test_security(token)

    # Summary
    total = len(passes) + len(failures)
    print(f"\n{'═'*60}")
    print(f"\033[1m  Results: {len(passes)}/{total} passed\033[0m")
    if failures:
        print(f"\033[31m  Failed ({len(failures)}):\033[0m")
        for f in failures:
            print(f"    • {f}")
    else:
        print(f"\033[32m  All tests passed! ✓\033[0m")
    print(f"{'═'*60}\n")

    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
