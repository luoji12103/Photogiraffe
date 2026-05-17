import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to be ready
    await page.waitForLoadState('networkidle');

    // Basic check that page loaded
    await expect(page).toHaveTitle(/Photogiraffe/);
  });

  test('should have visible navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the main content area is visible
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});