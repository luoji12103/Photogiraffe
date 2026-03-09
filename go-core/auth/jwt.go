package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims is the JWT payload.
// UserID holds the user's public UUID (never the sequential integer PK),
// preventing enumeration of internal database IDs.
type Claims struct {
	UserID   string `json:"uid"` // UUID v4 public identifier
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func jwtSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	return []byte(s)
}

func hs256GraceActive() bool {
	graceUntil := os.Getenv("JWT_HS256_GRACE_UNTIL")
	if graceUntil == "" {
		if deployedAt := os.Getenv("JWT_RS256_DEPLOYED_AT"); deployedAt != "" {
			t, err := time.Parse(time.RFC3339, deployedAt)
			if err != nil {
				return false
			}
			return time.Now().Before(t.Add(7 * 24 * time.Hour))
		}
		return false
	}
	t, err := time.Parse(time.RFC3339, graceUntil)
	if err != nil {
		return false
	}
	return time.Now().Before(t)
}

// GenerateAccessToken issues a short-lived access token (15 min).
// publicID must be the user's UUID v4 (User.PublicID), not the sequential integer PK.
func GenerateAccessToken(publicID, username, role string) (string, time.Time, error) {
	ttl := 15 * time.Minute
	exp := time.Now().Add(ttl)
	claims := Claims{
		UserID:   publicID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   publicID,
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	pk, err := GetPrivateKey()
	if err != nil {
		return "", time.Time{}, err
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(pk)
	return signed, exp, err
}

// ValidateAccessToken parses and verifies a JWT string.
func ValidateAccessToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		switch t.Method.Alg() {
		case jwt.SigningMethodRS256.Alg():
			pub, keyErr := GetPublicKey()
			if keyErr != nil {
				return nil, keyErr
			}
			return pub, nil
		case jwt.SigningMethodHS256.Alg():
			if !hs256GraceActive() {
				return nil, errors.New("hs256 grace period has ended")
			}
			return jwtSecret(), nil
		default:
			return nil, fmt.Errorf("unexpected signing method: %s", t.Method.Alg())
		}
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid token")
}

// GenerateRefreshToken creates a cryptographically secure random token and its SHA-256 hash.
// Returns (rawToken, sha256Hex, error).
func GenerateRefreshToken() (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(b)
	h := sha256.Sum256([]byte(raw))
	hashed := hex.EncodeToString(h[:])
	return raw, hashed, nil
}

// HashToken returns the SHA-256 hex of a raw token string.
func HashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}
