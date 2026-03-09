# Unresolved Issues & Technical Debt

## Critical Implementation Gaps

### 1. Session Store Dependency
**Problem**: CSRF middleware requires session store, but Photogiraffe has no session infrastructure
**Impact**: Cannot use recommended Synchronizer Token Pattern
**Workaround**: Use Double Submit Cookie pattern (less secure but functional)
**Technical Debt**: Need to implement proper session management for production

### 2. Key Rotation Automation
**Problem**: No automated key rotation mechanism
**Impact**: Manual key rotation increases operational risk
**Current State**: File-based key storage without rotation
**Required**: Automated rotation with graceful key distribution

### 3. Performance Bottleneck
**Problem**: RSA verification 100x slower than HMAC
**Impact**: Potential latency increase under load
**Mitigation**: Key caching + connection pooling
**Monitoring**: Need RSA operation duration metrics

### 4. Frontend CSRF Integration Complexity
**Problem**: SPA requires CookieHTTPOnly: false (XSS vulnerability)
**Impact**: CSRF tokens accessible to JavaScript
**Mitigation**: Strict CSP headers + token rotation
**Alternative**: Consider SameSite=Strict for higher security

## Architecture Limitations

### 1. Single Point of Failure
**Current**: Single JWT secret in environment variable
**Migration**: Single RSA private key file
**Risk**: Key compromise = full system breach
**Solution**: Hardware Security Module (HSM) or key escrow

### 2. No Key Versioning Strategy
**Current**: No key ID (kid) in JWT headers
**Migration**: Need to add kid to all new tokens
**Complexity**: Legacy token support during transition
**Timeline**: 7-day grace period may be insufficient

### 3. Distributed Key Management
**Problem**: Multiple service instances need same keys
**Current**: File-based storage per instance
**Scaling**: Shared storage or key distribution service
**Security**: Key synchronization without exposure

## Security Vulnerabilities

### 1. Algorithm Confusion Attack Vector
**Risk**: Attacker could force HS256 validation with RSA public key
**Mitigation**: Strict algorithm validation in KeyFunc
**Code Pattern**:
```go
if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
    return nil, fmt.Errorf("unexpected method: %v", token.Header["alg"])
}
```

### 2. Timing Side Channel
**Risk**: Different validation paths have different timing signatures
**Impact**: Attackers could distinguish token types
**Mitigation**: Constant-time operations where possible

### 3. CSRF Token Prediction
**Risk**: Weak random number generation
**Current**: utils.UUIDv4 (cryptographically secure)
**Validation**: Ensure crypto/rand usage

## Operational Challenges

### 1. Rollback Complexity
**Scenario**: Failed RS256 deployment
**Problem**: Users locked out with invalid tokens
**Solution**: Feature flag + immediate HS256 fallback
**Testing**: Need comprehensive rollback procedures

### 2. Monitoring Blind Spots
**Missing**: JWT validation method distribution
**Missing**: CSRF token generation/validation rates
**Missing**: Key rotation success/failure tracking
**Required**: Comprehensive security metrics

### 3. Development Environment Parity
**Problem**: Production uses secure keys, dev uses defaults
**Risk**: Security issues not caught in development
**Solution**: Secure key generation for all environments

## Integration Risks

### 1. Frontend Breaking Changes
**Risk**: CSRF implementation breaks existing API calls
**Impact**: All POST/PUT/DELETE operations fail
**Mitigation**: Gradual rollout with feature flags
**Testing**: Comprehensive frontend integration tests

### 2. Third-Party Service Integration
**Problem**: External services may cache JWKS responses
**Impact**: Key rotation could break external integrations
**Solution**: Proper cache-control headers + longer grace periods

### 3. Load Balancer Compatibility
**Problem**: CSRF tokens tied to specific server instances
**Impact**: Load balancing could break CSRF validation
**Solution**: Shared session store or sticky sessions

## Performance Degradation Risks

### 1. Memory Usage Growth
**Problem**: Multiple RSA keys in memory during grace period
**Impact**: Increased memory footprint per instance
**Monitoring**: Track key cache size and memory usage

### 2. CPU Intensive Operations
**Problem**: RSA operations are CPU-intensive
**Impact**: Reduced throughput under high load
**Mitigation**: Key caching + async validation where possible

### 3. Network Latency
**Problem**: JWKS endpoint adds network round-trip
**Impact**: External service integration latency
**Solution**: Aggressive caching + CDN distribution

## Compliance & Audit Concerns

### 1. Key Material Audit Trail
**Problem**: No audit log for key access/rotation
**Compliance**: SOC2/ISO27001 requirements
**Solution**: Comprehensive key management logging

### 2. Token Lifecycle Tracking
**Problem**: No visibility into token usage patterns
**Audit**: Need token issuance/validation logs
**Privacy**: Balance logging with user privacy

### 3. Security Incident Response
**Problem**: No procedures for key compromise
**Impact**: Delayed response to security incidents
**Required**: Incident response playbook for key rotation
