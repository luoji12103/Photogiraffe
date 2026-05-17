# Concrete Implementation Guide

## Immediate Action Items

### 1. Fiber v3 Upgrade (Priority: HIGH)
```bash
# Update go.mod
go mod edit -require github.com/gofiber/fiber/v3@latest
go mod tidy

# Update imports in main.go
sed -i 's|github.com/gofiber/fiber/v2|github.com/gofiber/fiber/v3|g' go-core/main.go
```

**Breaking Changes to Address**:
- CORS middleware import path
- CSRF middleware configuration syntax
- Potential handler signature changes

### 2. CSRF Middleware Integration
```go
// Add to main.go after CORS middleware
import "github.com/gofiber/fiber/v3/middleware/csrf"

// Configure for SPA usage
app.Use(csrf.New(csrf.Config{
    CookieName:        "__Host-csrf_",
    CookieSecure:      true,
    CookieHTTPOnly:    false,  // Required for SPA
    CookieSameSite:    "Lax",
    CookieSessionOnly: true,
    IdleTimeout:       30 * time.Minute,
    KeyGenerator:      utils.UUIDv4,
    Extractor:         extractors.FromHeader("X-Csrf-Token"),
    // Note: No session store initially (use Double Submit Cookie)
}))

// Add CSRF token endpoint
app.Get("/api/auth/csrf-token", requireJWT(), func(c *fiber.Ctx) error {
    token := csrf.TokenFromContext(c)
    return c.JSON(fiber.Map{"csrf_token": token})
})
```

### 3. Update CORS Configuration
```go
// Update AllowHeaders to include CSRF token
app.Use(cors.New(cors.Config{
    AllowOrigins: corsAllowOrigin,
    AllowHeaders: "Origin, Content-Type, Accept, Authorization, X-Internal-Secret, X-Csrf-Token",
    AllowMethods: "GET, POST, PUT, DELETE, OPTIONS",
}))
```

## JWT RS256 Migration Implementation

### 1. Key Management Service
```go
// Create go-core/auth/keymanager.go
package auth

import (
    "crypto/rsa"
    "crypto/x509"
    "encoding/pem"
    "fmt"
    "os"
    "path/filepath"
    "sync"
    "time"
)

type KeyManager struct {
    mu                sync.RWMutex
    currentPrivateKey *rsa.PrivateKey
    currentPublicKey  *rsa.PublicKey
    currentKeyID      string
    previousKeys      map[string]*rsa.PublicKey
    keyDir            string
    gracePeriod       time.Duration
}

func NewKeyManager(keyDir string) (*KeyManager, error) {
    km := &KeyManager{
        keyDir:       keyDir,
        gracePeriod:  7 * 24 * time.Hour, // 7 days
        previousKeys: make(map[string]*rsa.PublicKey),
    }
    
    if err := km.loadCurrentKey(); err != nil {
        return nil, err
    }
    
    if err := km.loadPreviousKeys(); err != nil {
        return nil, err
    }
    
    return km, nil
}

func (km *KeyManager) loadCurrentKey() error {
    privateKeyPath := filepath.Join(km.keyDir, "current", "private.pem")
    publicKeyPath := filepath.Join(km.keyDir, "current", "public.pem")
    kidPath := filepath.Join(km.keyDir, "current", "kid.txt")
    
    // Load private key
    privPEM, err := os.ReadFile(privateKeyPath)
    if err != nil {
        return fmt.Errorf("failed to read private key: %w", err)
    }
    
    km.currentPrivateKey, err = jwt.ParseRSAPrivateKeyFromPEM(privPEM)
    if err != nil {
        return fmt.Errorf("failed to parse private key: %w", err)
    }
    
    // Load public key
    pubPEM, err := os.ReadFile(publicKeyPath)
    if err != nil {
        return fmt.Errorf("failed to read public key: %w", err)
    }
    
    km.currentPublicKey, err = jwt.ParseRSAPublicKeyFromPEM(pubPEM)
    if err != nil {
        return fmt.Errorf("failed to parse public key: %w", err)
    }
    
    // Load key ID
    kidBytes, err := os.ReadFile(kidPath)
    if err != nil {
        return fmt.Errorf("failed to read key ID: %w", err)
    }
    
    km.currentKeyID = strings.TrimSpace(string(kidBytes))
    return nil
}
```

### 2. Dual Validation Implementation
```go
// Update go-core/auth/jwt.go
func ValidateAccessTokenDual(tokenStr string) (*Claims, error) {
    // Try RS256 first (new tokens)
    if claims, err := validateRS256Token(tokenStr); err == nil {
        return claims, nil
    }
    
    // Fallback to HS256 (legacy tokens during grace period)
    if claims, err := ValidateAccessToken(tokenStr); err == nil {
        // Log for monitoring
        log.Printf("Legacy HS256 token validated for user: %s", claims.UserID)
        return claims, nil
    }
    
    return nil, errors.New("token validation failed")
}

func validateRS256Token(tokenStr string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        // Validate algorithm
        if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
            return nil, fmt.Errorf("unexpected method: %v", token.Header["alg"])
        }
        
        // Get key ID
        kidInterface, ok := token.Header["kid"]
        if !ok {
            return nil, errors.New("missing key ID")
        }
        
        kid, ok := kidInterface.(string)
        if !ok {
            return nil, errors.New("invalid key ID format")
        }
        
        return keyManager.GetPublicKey(kid)
    })
    
    if err != nil {
        return nil, err
    }
    
    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        return claims, nil
    }
    
    return nil, errors.New("invalid token")
}
```

### 3. JWKS Endpoint Implementation
```go
// Add to main.go
app.Get("/api/auth/jwks", func(c *fiber.Ctx) error {
    jwks := keyManager.GetJWKS()
    
    // Set cache headers
    c.Set("Cache-Control", "public, max-age=300") // 5 minutes
    c.Set("Content-Type", "application/json")
    
    return c.JSON(jwks)
})
```

## Frontend Integration Changes

### 1. CSRF Token Management
```typescript
// Add to auth context
interface AuthContextType {
    // ... existing fields
    csrfToken: string | null;
    refreshCSRFToken: () => Promise<void>;
}

// Fetch CSRF token on login
const fetchCSRFToken = async (): Promise<string> => {
    const response = await fetch('/api/auth/csrf-token', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });
    
    if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
    }
    
    const data = await response.json();
    return data.csrf_token;
};

// Include CSRF token in API calls
const apiCall = async (url: string, options: RequestInit = {}) => {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        ...options.headers,
    };
    
    // Add CSRF token for state-changing operations
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method?.toUpperCase() || '')) {
        if (csrfToken) {
            headers['X-Csrf-Token'] = csrfToken;
        }
    }
    
    return fetch(url, {
        ...options,
        headers,
    });
};
```

## Deployment Strategy

### 1. Environment Variables
```bash
# Add to .env
JWT_KEY_DIR=/etc/photogiraffe/keys
CSRF_ENABLED=true
JWT_MIGRATION_MODE=dual  # dual|rs256_only|hs256_only
```

### 2. Key Generation Script
```bash
#!/bin/bash
# scripts/generate-keys.sh

KEY_DIR=${JWT_KEY_DIR:-/etc/photogiraffe/keys}
CURRENT_DIR="$KEY_DIR/current"

# Create directories
mkdir -p "$CURRENT_DIR"

# Generate RSA key pair
openssl genrsa -out "$CURRENT_DIR/private.pem" 2048
openssl rsa -in "$CURRENT_DIR/private.pem" -pubout -out "$CURRENT_DIR/public.pem"

# Generate key ID
echo "$(date +%Y%m%d)-$(openssl rand -hex 4)" > "$CURRENT_DIR/kid.txt"

# Set permissions
chmod 600 "$CURRENT_DIR/private.pem"
chmod 644 "$CURRENT_DIR/public.pem"
chmod 644 "$CURRENT_DIR/kid.txt"

echo "Keys generated in $CURRENT_DIR"
```

### 3. Docker Compose Updates
```yaml
# Add to docker-compose.yml
services:
  go-core:
    volumes:
      - ./keys:/etc/photogiraffe/keys:ro
    environment:
      - JWT_KEY_DIR=/etc/photogiraffe/keys
      - CSRF_ENABLED=true
```

## Testing Strategy

### 1. Unit Tests
```go
// go-core/auth/jwt_test.go - Add RS256 tests
func TestRS256TokenGeneration(t *testing.T) {
    // Test RS256 token generation and validation
}

func TestDualValidation(t *testing.T) {
    // Test both HS256 and RS256 validation
}

func TestKeyRotation(t *testing.T) {
    // Test key rotation scenarios
}
```

### 2. Integration Tests
```bash
# Test CSRF protection
curl -X POST http://localhost:8080/api/photos/1/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Csrf-Token: $CSRF_TOKEN"

# Test JWKS endpoint
curl http://localhost:8080/api/auth/jwks
```

## Monitoring & Alerting

### 1. Metrics to Track
```go
// Add metrics collection
var (
    jwtValidationCounter = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "jwt_validations_total",
            Help: "Total JWT validations by algorithm",
        },
        []string{"algorithm", "result"},
    )
    
    csrfTokenCounter = prometheus.NewCounter(
        prometheus.CounterOpts{
            Name: "csrf_tokens_generated_total",
            Help: "Total CSRF tokens generated",
        },
    )
)
```

### 2. Health Check Updates
```go
// Add to health endpoint
app.Get("/health", func(c *fiber.Ctx) error {
    health := map[string]interface{}{
        "database": checkDatabase(),
        "keys":     keyManager.HealthCheck(),
        "csrf":     checkCSRF(),
    }
    
    return c.JSON(health)
})
```

This implementation guide provides concrete, actionable steps for implementing the security migration while minimizing risk and maintaining system stability.
