# Critical Issues & Gotchas

## Fiber v3 Migration Issues

### Breaking Changes
1. **Middleware Import Paths**
   - Old: `github.com/gofiber/fiber/v2/middleware/csrf`
   - New: `github.com/gofiber/fiber/v3/middleware/csrf`

2. **CSRF Configuration Changes**
   - `KeyLookup` field removed → use `Extractor` instead
   - New extractors API: `extractors.FromHeader("X-Csrf-Token")`

3. **CORS Headers Update Required**
   - Must add "X-Csrf-Token" to AllowHeaders
   - Current: `"Origin, Content-Type, Accept, Authorization, X-Internal-Secret"`
   - Updated: `"Origin, Content-Type, Accept, Authorization, X-Internal-Secret, X-Csrf-Token"`

## JWT RS256 Migration Pitfalls

### Algorithm Confusion Attacks
```go
// CRITICAL: Always validate algorithm in KeyFunc
func keyFunc(token *jwt.Token) (interface{}, error) {
    // This prevents algorithm confusion attacks
    if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
        return nil, fmt.Errorf("unexpected method: %v", token.Header["alg"])
    }
    return publicKey, nil
}
```

### Key ID (kid) Header Issues
- Missing `kid` in token header breaks JWKS validation
- Must add `kid` to all new tokens during migration
- Legacy tokens without `kid` need fallback handling

### Grace Period Complexity
- Two validation paths increase attack surface
- Memory usage grows with multiple keys
- Clock skew between services can cause issues
- Need clear timeline for legacy key removal

## Photogiraffe-Specific Risks

### Current Authentication Flow
```go
// Current: requireJWT() middleware extracts user data
c.Locals("userID", row.ID)              // uint
c.Locals("userPublicID", claims.UserID) // UUID string  
c.Locals("userRole", claims.Role)
c.Locals("username", claims.Username)
```
**Risk**: Changing JWT validation logic could break all protected endpoints

### Database Integration Points
- User lookup by PublicID (UUID) in requireJWT()
- Refresh token validation uses HMAC hashing
- Login history recording depends on user resolution

### Frontend Integration Challenges
- SPA needs CSRF token access via JavaScript
- Current auth uses Authorization header + refresh cookie
- Adding CSRF requires coordinated frontend changes

## Performance & Scalability Issues

### RSA vs HMAC Performance
- RSA-256 verification: ~1000 ops/sec
- HMAC-SHA256 verification: ~100,000 ops/sec
- 100x performance difference under load

### Key Caching Requirements
```go
// Bad: Parse key on every request
key, _ := jwt.ParseRSAPublicKeyFromPEM(pemBytes)

// Good: Cache parsed keys
type KeyCache struct {
    keys map[string]*rsa.PublicKey
    mu   sync.RWMutex
}
```

### JWKS Endpoint Caching
- External services will cache JWKS responses
- Key rotation requires cache invalidation strategy
- Consider TTL headers and cache-control

## Security Vulnerabilities

### CSRF Token Exposure
- SPA configuration requires CookieHTTPOnly: false
- CSRF tokens accessible to JavaScript (XSS risk)
- Must implement proper CSP headers

### Key Management Risks
- RSA private keys more sensitive than HMAC secrets
- Key rotation failure = service outage
- Backup key storage critical

### Timing Attack Vectors
- Different validation paths have different timing
- Grace period creates timing side channels
- Need constant-time comparisons where possible

## Rollback Scenarios

### Failed CSRF Deployment
- Frontend can't get CSRF tokens
- All POST/PUT/DELETE requests fail
- Need feature flag to disable CSRF

### Failed JWT Migration
- New tokens can't be validated
- Users locked out of system
- Need immediate rollback to HS256

### Key Rotation Failure
- New keys not distributed
- Token validation fails
- Need emergency key recovery procedure
