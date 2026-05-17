# Architectural Decisions & Rationales

## Decision 1: Fiber v3 Upgrade Timing
**Decision**: Upgrade to Fiber v3 before implementing CSRF
**Rationale**: 
- v3 has improved CSRF middleware with better SPA support
- Extractors API is more flexible than deprecated KeyLookup
- Session integration is more robust in v3
- Breaking changes are manageable in current codebase size

## Decision 2: CSRF Implementation Strategy
**Decision**: Use Double Submit Cookie pattern with Session store
**Rationale**:
- Current codebase doesn't have session infrastructure
- Double Submit Cookie works well with SPA architecture
- Session store provides better security than memory storage
- Aligns with Fiber v3 recommendations

**Configuration**:
```go
csrf.Config{
    CookieName:        "__Host-csrf_",
    CookieSecure:      true,
    CookieHTTPOnly:    false,  // Required for SPA
    CookieSameSite:    "Lax",
    Session:           sessionStore,
    Extractor:         extractors.FromHeader("X-Csrf-Token"),
}
```

## Decision 3: JWT Migration Approach
**Decision**: Gradual migration with 7-day grace period
**Rationale**:
- Minimizes user disruption
- Allows rollback if issues discovered
- Matches existing refresh token TTL (7 days)
- Provides time for frontend updates

**Timeline**:
1. Day 0: Deploy dual validation (HS256 + RS256)
2. Day 1: Switch new token generation to RS256
3. Day 7: Remove HS256 validation support

## Decision 4: Key Management Strategy
**Decision**: File-based key storage with environment path
**Rationale**:
- Simpler than external key management for initial implementation
- Keys stored outside container filesystem
- Environment variable points to key directory
- Can migrate to Vault/KMS later

**Structure**:
```
/etc/photogiraffe/keys/
├── current/
│   ├── private.pem
│   ├── public.pem
│   └── kid.txt
└── previous/
    ├── 2026-03-01/
    │   ├── public.pem
    │   └── kid.txt
    └── 2026-02-15/
        ├── public.pem
        └── kid.txt
```

## Decision 5: JWKS Endpoint Design
**Decision**: Implement internal JWKS endpoint at `/api/auth/jwks`
**Rationale**:
- Enables external service integration
- Standard JWT ecosystem pattern
- Supports key rotation transparency
- Required for microservice architecture

## Decision 6: Backward Compatibility Strategy
**Decision**: Maintain existing middleware interface
**Rationale**:
- 50+ protected endpoints in current codebase
- c.Locals() pattern used throughout
- Minimizes code changes during migration
- Reduces regression risk

**Implementation**:
```go
// Keep existing interface
func requireJWT() fiber.Handler {
    return func(c *fiber.Ctx) error {
        // New validation logic (HS256 + RS256)
        claims, err := validateTokenDual(tokenStr)
        
        // Same c.Locals() assignments
        c.Locals("userID", row.ID)
        c.Locals("userPublicID", claims.UserID)
        // ...
    }
}
```

## Decision 7: Performance Optimization Strategy
**Decision**: Implement key caching with 5-minute TTL
**Rationale**:
- RSA verification is 100x slower than HMAC
- Key parsing is expensive operation
- 5-minute TTL balances performance vs security
- Memory usage acceptable for key count

## Decision 8: Error Handling During Migration
**Decision**: Fail open for CSRF, fail closed for JWT
**Rationale**:
- CSRF failures shouldn't break existing functionality
- JWT failures must maintain security
- Feature flags allow gradual rollout
- Monitoring alerts on validation failures

## Decision 9: Frontend Integration Approach
**Decision**: Add CSRF token to existing auth context
**Rationale**:
- Minimal changes to existing auth flow
- Token fetched on login/refresh
- Automatic inclusion in API calls
- Graceful degradation if CSRF disabled

## Decision 10: Monitoring & Alerting Strategy
**Decision**: Track validation method distribution and failures
**Rationale**:
- Monitor migration progress (HS256 vs RS256 usage)
- Alert on validation failures above threshold
- Track CSRF token generation/validation rates
- Performance metrics for RSA operations

**Metrics**:
- `jwt_validation_method{algorithm="HS256|RS256"}` - counter
- `jwt_validation_errors{reason="expired|invalid|unknown_key"}` - counter  
- `csrf_token_generation_rate` - gauge
- `rsa_verification_duration` - histogram
