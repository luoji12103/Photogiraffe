# Security Migration Documentation & Patterns

## Current State Analysis
- **JWT Implementation**: HS256 symmetric signing with single secret
- **Fiber Version**: v2.52.11 (needs upgrade to v3 for latest CSRF features)
- **Current Auth**: Bearer token in Authorization header, 15min TTL
- **Refresh Pattern**: 7-day rotating refresh tokens in HTTP-only cookies

## Fiber CSRF Middleware Patterns

### V3 Configuration (Recommended)
```go
import "github.com/gofiber/fiber/v3/middleware/csrf"

// Production SPA Configuration
app.Use(csrf.New(csrf.Config{
    CookieName:        "__Host-csrf_",
    CookieSecure:      true,
    CookieHTTPOnly:    false,       // Required for SPA JavaScript access
    CookieSameSite:    "Lax",
    CookieSessionOnly: true,
    IdleTimeout:       30 * time.Minute,
    KeyGenerator:      utils.UUIDv4,
    Extractor:         extractors.FromHeader("X-Csrf-Token"),
    Session:           sessionStore,  // Recommended for production
    TrustedOrigins:    []string{"https://yourdomain.com"},
}))
```

### Token Extraction Patterns
```go
// V3 uses Extractor instead of deprecated KeyLookup
Extractor: extractors.FromHeader("X-Csrf-Token"),
// Alternative extractors:
// extractors.FromForm("csrf_token")
// extractors.FromQuery("csrf")
```

### Handler Integration
```go
func handler(c fiber.Ctx) error {
    // Get CSRF token for frontend
    token := csrf.TokenFromContext(c)
    if token == "" {
        return c.Status(500).JSON(fiber.Map{"error": "CSRF token not available"})
    }
    return c.JSON(fiber.Map{"csrf_token": token})
}
```

## JWT RS256 Migration Patterns

### Key Management Structure
```go
type KeyManager struct {
    currentPrivateKey *rsa.PrivateKey
    currentPublicKey  *rsa.PublicKey
    currentKeyID      string
    
    // Grace period support
    previousKeys      map[string]*rsa.PublicKey
    keyRotationTime   time.Time
    gracePeriod       time.Duration
}
```

### Dual Validation Implementation
```go
func (km *KeyManager) ValidateToken(tokenStr string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        // Validate algorithm
        if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
            return nil, fmt.Errorf("unexpected method: %v", token.Header["alg"])
        }
        
        // Get key ID from header
        kidInterface, ok := token.Header["kid"]
        if !ok {
            return nil, errors.New("missing key ID in token header")
        }
        kid, ok := kidInterface.(string)
        if !ok {
            return nil, errors.New("invalid key ID format")
        }
        
        // Try current key first
        if kid == km.currentKeyID {
            return km.currentPublicKey, nil
        }
        
        // Try previous keys during grace period
        if time.Since(km.keyRotationTime) < km.gracePeriod {
            if prevKey, exists := km.previousKeys[kid]; exists {
                return prevKey, nil
            }
        }
        
        return nil, fmt.Errorf("unknown key ID: %s", kid)
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

### JWKS Endpoint Pattern
```go
type JWKSResponse struct {
    Keys []JWK `json:"keys"`
}

type JWK struct {
    Kty string `json:"kty"`
    Kid string `json:"kid"`
    Use string `json:"use"`
    N   string `json:"n"`
    E   string `json:"e"`
}

func (km *KeyManager) GetJWKS() JWKSResponse {
    keys := []JWK{}
    
    // Add current key
    keys = append(keys, km.publicKeyToJWK(km.currentPublicKey, km.currentKeyID))
    
    // Add previous keys during grace period
    if time.Since(km.keyRotationTime) < km.gracePeriod {
        for kid, pubKey := range km.previousKeys {
            keys = append(keys, km.publicKeyToJWK(pubKey, kid))
        }
    }
    
    return JWKSResponse{Keys: keys}
}
```

## Migration Strategy for Photogiraffe

### Phase 1: Fiber v3 Upgrade
1. Update go.mod: `github.com/gofiber/fiber/v3`
2. Update CORS middleware import
3. Update CSRF middleware configuration
4. Test existing endpoints compatibility

### Phase 2: CSRF Integration
1. Add CSRF middleware to protected routes
2. Update frontend to fetch and send CSRF tokens
3. Configure for SPA usage (CookieHTTPOnly: false)

### Phase 3: JWT RS256 Migration
1. Generate RSA key pairs
2. Implement dual validation (HS256 + RS256)
3. Update token generation to RS256
4. Maintain HS256 validation during grace period
5. Remove HS256 support after grace period

### Specific Pitfalls for This Codebase

1. **Fiber v2 → v3 Breaking Changes**
   - Middleware import paths changed
   - Some configuration options renamed
   - CORS AllowHeaders may need updates

2. **CSRF + SPA Integration**
   - Must set CookieHTTPOnly: false for JavaScript access
   - Frontend needs to read CSRF token from cookie
   - All state-changing requests need X-Csrf-Token header

3. **JWT Migration Complexity**
   - Current code uses c.Locals() for user data
   - Need to maintain compatibility during migration
   - Refresh token rotation must work with both algorithms

4. **Key Storage Security**
   - RSA private keys need secure storage (not environment variables)
   - Consider using external key management (Vault, AWS KMS)
   - Key rotation requires coordinated deployment

5. **Performance Considerations**
   - RSA verification is slower than HMAC
   - Cache public keys to avoid repeated parsing
   - Consider connection pooling for JWKS fetching

## Implementation Checklist

### CSRF Middleware
- [ ] Upgrade to Fiber v3
- [ ] Configure CSRF for SPA usage
- [ ] Add token endpoint for frontend
- [ ] Update all state-changing endpoints
- [ ] Test with existing authentication

### JWT RS256 Migration
- [ ] Generate RSA key pairs
- [ ] Implement key management service
- [ ] Add JWKS endpoint
- [ ] Implement dual validation
- [ ] Update token generation
- [ ] Plan grace period timeline
- [ ] Update frontend token handling
- [ ] Remove legacy HS256 support

### Security Considerations
- [ ] Secure key storage implementation
- [ ] Key rotation automation
- [ ] Monitoring and alerting
- [ ] Rollback procedures
- [ ] Performance testing
