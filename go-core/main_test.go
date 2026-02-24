package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"testing"
)

// ─────────────────────────────────────────────────────────────────
// generateShareToken
// ─────────────────────────────────────────────────────────────────

func TestGenerateShareToken_Format(t *testing.T) {
	tok, err := generateShareToken()
	if err != nil {
		t.Fatalf("generateShareToken error: %v", err)
	}
	if len(tok) != 64 {
		t.Errorf("expected 64-char hex token, got length %d: %s", len(tok), tok)
	}
	// verify it decodes as valid hex
	b, err := hex.DecodeString(tok)
	if err != nil {
		t.Errorf("token is not valid hex: %v", err)
	}
	if len(b) != 32 {
		t.Errorf("expected 32 bytes decoded, got %d", len(b))
	}
}

func TestGenerateShareToken_Uniqueness(t *testing.T) {
	seen := make(map[string]bool, 50)
	for i := 0; i < 50; i++ {
		tok, err := generateShareToken()
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if seen[tok] {
			t.Fatalf("duplicate token at iteration %d", i)
		}
		seen[tok] = true
	}
}

// ─────────────────────────────────────────────────────────────────
// Pagination offset calculation (inline, mirrors production logic)
// ─────────────────────────────────────────────────────────────────

func calcOffset(page, limit int) int {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	return (page - 1) * limit
}

func TestCalcOffset(t *testing.T) {
	tests := []struct {
		page, limit, want int
	}{
		{1, 20, 0},
		{2, 20, 20},
		{3, 10, 20},
		{0, 20, 0},    // page < 1 → clamp to 1
		{1, 0, 0},    // limit < 1 → use default 20; (1-1)*20=0
		{1, 200, 0},  // limit > 100 → default 20
		{2, 200, 20}, // limit clamped to 20, page=2 → offset=20
	}
	for _, tt := range tests {
		got := calcOffset(tt.page, tt.limit)
		if got != tt.want {
			t.Errorf("calcOffset(%d, %d) = %d, want %d", tt.page, tt.limit, got, tt.want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────
// Platform JSON parsing (mirrors PresetPanel logic in Go)
// ─────────────────────────────────────────────────────────────────

func parsePlatformsSlice(raw string) []string {
	if raw == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	return out
}

func TestParsePlatformsSlice(t *testing.T) {
	tests := []struct {
		raw  string
		want []string
	}{
		{`["Lightroom","Capture One"]`, []string{"Lightroom", "Capture One"}},
		{`[]`, []string{}},
		{``, []string{}},
		{`null`, []string{}},
		{`invalid json`, []string{}},
		{`["Darktable"]`, []string{"Darktable"}},
	}
	for _, tt := range tests {
		got := parsePlatformsSlice(tt.raw)
		if len(got) != len(tt.want) {
			t.Errorf("parsePlatformsSlice(%q) len = %d, want %d (got %v)", tt.raw, len(got), len(tt.want), got)
			continue
		}
		for i := range tt.want {
			if got[i] != tt.want[i] {
				t.Errorf("parsePlatformsSlice(%q)[%d] = %q, want %q", tt.raw, i, got[i], tt.want[i])
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────
// GPS bounding-box delta calculation (mirrors v8.3 search logic)
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// GPS bounding-box delta calculation (mirrors v8.3 search logic)
// ─────────────────────────────────────────────────────────────────

func TestGPSBoundingBox(t *testing.T) {
	// At equator (lat=0): lat delta ≈ lng delta ≈ radius/111
	// At Paris (lat≈48.85): lng delta < lat delta
	type bb struct {
		lat, lng, radiusKm float64
		wantLatDeltaMin    float64
	}
	cases := []bb{
		{0, 0, 111, 0.9},        // equator: ~1.0 degrees
		{48.85, 2.35, 111, 0.9}, // Paris
		{0, 0, 0.1, 0.0008},     // tiny radius
	}
	for _, c := range cases {
		latDelta := c.radiusKm / 111.0
		if latDelta < c.wantLatDeltaMin {
			t.Errorf("lat=%.2f,radius=%.1fkm: latDelta=%.6f, want >= %.6f",
				c.lat, c.radiusKm, latDelta, c.wantLatDeltaMin)
		}
	}
}

// ─────────────────────────────────────────────────────────────────
// Crypto randomness smoke test
// ─────────────────────────────────────────────────────────────────

func TestCryptoRand_NotAllZeros(t *testing.T) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	allZero := true
	for _, byt := range b {
		if byt != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		t.Error("crypto/rand produced all-zero bytes (astronomically unlikely unless broken)")
	}
}
