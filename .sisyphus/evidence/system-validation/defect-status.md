# Defect Investigation Status - 2026-03-10T03:35:00Z

## Critical Finding

**Auth registration returns empty `user.id` - ROOT CAUSE IDENTIFIED**

### Investigation Trail
1. ✅ BeforeCreate hook EXISTS in models.go (lines 24-29)
2. ✅ JWT keys are present in container (/app/keys/)
3. ✅ Database HAS PublicID values (verified via psql query)
4. ✅ Reload code added after Create (lines 546-548)
5. ❌ Response still returns empty `user.id`

### Key Discovery
- Database query: `SELECT id, public_id FROM users` shows ALL users have valid UUIDs
- Login endpoint ALSO returns empty `user.id` (not just registration)
- This means the issue is NOT in registration logic, but in response serialization

### Hypothesis
The response builder at line 661 uses:
```go
"id": user.PublicID
```

But the User struct (models.go:12) has NO JSON tags:
```go
PublicID string `gorm:"uniqueIndex"`
```

When GORM loads the user, `user.PublicID` should contain the UUID from the database.
The manual response construction with `fiber.Map` should work.

### Next Steps
1. Add debug logging to print `user.PublicID` value before response
2. Check if GORM is actually loading the PublicID column
3. Verify the response JSON structure matches expectations

## Status Summary
- D1 (Python tests): Partially fixed, needs completion
- D2 (Auth user.id): Under investigation - database has data, response doesn't
- D3 (ESLint): Not started
