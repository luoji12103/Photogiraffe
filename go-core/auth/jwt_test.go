package auth

import (
	"strings"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────────
// GenerateAccessToken / ValidateAccessToken
// ─────────────────────────────────────────────────────────────────

func TestGenerateAndValidateAccessToken(t *testing.T) {
	tests := []struct {
		name     string
		userID   uint
		username string
		role     string
	}{
		{"standard user", 1, "alice", "StandardUser"},
		{"super admin", 2, "admin", "SuperAdmin"},
		{"zero user id", 0, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			signed, exp, err := GenerateAccessToken(tt.userID, tt.username, tt.role)
			if err != nil {
				t.Fatalf("GenerateAccessToken error: %v", err)
			}
			if signed == "" {
				t.Fatal("expected non-empty token string")
			}
			if exp.Before(time.Now()) {
				t.Error("expiry should be in the future")
			}

			claims, err := ValidateAccessToken(signed)
			if err != nil {
				t.Fatalf("ValidateAccessToken error: %v", err)
			}
			if claims.UserID != tt.userID {
				t.Errorf("UserID: got %d, want %d", claims.UserID, tt.userID)
			}
			if claims.Username != tt.username {
				t.Errorf("Username: got %q, want %q", claims.Username, tt.username)
			}
			if claims.Role != tt.role {
				t.Errorf("Role: got %q, want %q", claims.Role, tt.role)
			}
		})
	}
}

func TestValidateAccessToken_Invalid(t *testing.T) {
	cases := []struct{ name, token string }{
		{"empty string", ""},
		{"garbage", "not.a.jwt"},
		{"wrong sig", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxfQ.wrong"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ValidateAccessToken(c.token)
			if err == nil {
				t.Error("expected error for invalid token, got nil")
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────
// GenerateRefreshToken
// ─────────────────────────────────────────────────────────────────

func TestGenerateRefreshToken(t *testing.T) {
	raw, hashed, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken error: %v", err)
	}
	if len(raw) < 32 {
		t.Errorf("raw token too short: %d chars", len(raw))
	}
	if len(hashed) != 64 {
		t.Errorf("expected 64-char SHA-256 hex, got %d", len(hashed))
	}
	// recompute hash to verify consistency
	recomputed := HashToken(raw)
	if recomputed != hashed {
		t.Errorf("HashToken(%q) = %q, want %q", raw, recomputed, hashed)
	}
}

func TestGenerateRefreshToken_Uniqueness(t *testing.T) {
	seen := make(map[string]struct{}, 20)
	for i := 0; i < 20; i++ {
		raw, _, err := GenerateRefreshToken()
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if _, dup := seen[raw]; dup {
			t.Fatalf("duplicate refresh token generated at iter %d", i)
		}
		seen[raw] = struct{}{}
	}
}

// ─────────────────────────────────────────────────────────────────
// HashToken
// ─────────────────────────────────────────────────────────────────

func TestHashToken(t *testing.T) {
	h1 := HashToken("hello")
	h2 := HashToken("hello")
	if h1 != h2 {
		t.Error("HashToken is not deterministic")
	}
	if len(h1) != 64 {
		t.Errorf("expected 64-char hex, got %d", len(h1))
	}
	if !isHex(h1) {
		t.Errorf("result is not valid hex: %s", h1)
	}
	h3 := HashToken("world")
	if h1 == h3 {
		t.Error("different inputs produced same hash")
	}
}

func isHex(s string) bool {
	for _, c := range strings.ToLower(s) {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}
