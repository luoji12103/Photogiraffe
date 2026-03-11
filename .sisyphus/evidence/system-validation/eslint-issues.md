# ESLint Issues - System-Wide Validation

## Status: Documented (Not Fixed)

**Reason**: These are code quality issues that don't block functionality. Fixing them is outside the scope of the validation campaign.

## Summary
- **Total**: 19 errors, 55 warnings
- **Fixable**: 3 warnings auto-fixable with --fix

## Error Categories

### 1. Unescaped Quotes (4 errors)
- `admin/page.tsx:543:37,52` - Chinese text with quotes
- `admin/page.tsx:561:27,33` - Chinese text with quotes
- **Fix**: Replace `"` with `&quot;` or use proper JSX escaping

### 2. setState in useEffect (7 errors)
- `favorites/page.tsx:44`
- `notifications/page.tsx:53`
- `search/page.tsx:39`
- `ClientLayout.tsx:391`
- `PhotoGrid.tsx:43,50`
- **Fix**: Move setState to callbacks or use functional updates

### 3. Ref Access During Render (2 errors)
- `PhotoGrid.tsx:46,47`
- **Fix**: Move ref access to useEffect or event handlers

### 4. Impure Function in Render (1 error)
- `PhotoGrid.tsx:237` - Math.random() call
- **Fix**: Use useMemo or compute outside render

### 5. HTML Links (2 errors)
- `search/page.tsx:89,172` - Using `<a>` instead of `<Link>`
- **Fix**: Import and use Next.js Link component

### 6. TypeScript any (3 errors)
- `notifications/page.tsx:25`
- `search/page.tsx:35`
- `PhotoGrid.tsx:193,244`
- **Fix**: Define proper interfaces/types

## Recommendation
Create a separate task/PR to address these code quality issues after the validation campaign completes.
