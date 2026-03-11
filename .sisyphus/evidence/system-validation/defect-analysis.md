# Defect Analysis - System-Wide Validation

## D1: 2 Python Integration Test Failures (HIGH)

### Test 1: "description persisted"
**Location**: tests/integration_test.py:503
**Test Code**: 
```python
check("  description persisted", isinstance(d, dict) and d.get("Description") == "Test caption", d)
```
**Expected**: Photo detail response has `Description` field with "Test caption"
**Actual**: Field missing or different value
**Root Cause**: Response structure mismatch - test expects capitalized `Description` but API may return lowercase `description`

### Test 2: "photo has UserID field"
**Location**: tests/integration_test.py:612
**Test Code**:
```python
check("  photo has UserID field", isinstance(pd, dict) and "UserID" in pd, pd)
```
**Expected**: Photo detail response includes `UserID` field
**Actual**: Field missing from response
**Root Cause**: Photo model may not include UserID in JSON response, or field is named differently

## D2: Auth Registration Empty user_id (HIGH)

**Location**: go-core/main.go:576
**Issue**: Registration returns empty `user.id` field
**Code**:
```go
"user": fiber.Map{
    "id":       user.PublicID, // UUID — never expose sequential integer PK
    "username": user.Username,
    "email":    user.Email,
    "role":     user.Role,
},
```
**Root Cause**: `user.PublicID` is empty because no BeforeCreate hook sets it
**Model**: User struct has `PublicID string` field but no auto-generation logic

## D3: 19 ESLint Errors (MEDIUM)

### Error Categories:
1. **Unescaped quotes** (4 errors): admin/page.tsx lines 543, 561
2. **setState in useEffect** (7 errors): Multiple files calling setState synchronously
3. **Ref access during render** (2 errors): Accessing ref.current during render
4. **Math.random in render** (1 error): Impure function call
5. **HTML links** (2 errors): Using `<a>` instead of Next.js `<Link>`
6. **TypeScript any** (3 errors): Explicit any types

**Priority**: Medium (code quality, not blocking functionality)
