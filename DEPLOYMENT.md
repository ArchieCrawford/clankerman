# Deployment Guide

## Environment Variables

When deploying the Clanker Man Treasury Dashboard via webhooks (e.g., Vercel, Netlify), ensure the following environment variables are properly configured:

### Required Variables
These **must** be set for the build to succeed:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous/public key

### Optional Variables (with defaults)
These have sensible defaults but can be overridden:
- `TREASURY_ADDRESS` (default: `0x8D4aB2A3E89EadfDC729204adF863A0Bfc7746F6`)
- `BUYBACK_ADDRESS` (default: `0x1195B555885C313614AF705D97db22881D2fbABD`)
- `BNKR_ADDRESS` (default: `0x22af33fe49fd1fa80c7149773dde5890d3c76f3b`)
- `FEE_ACCUM_ADDRESS` (default: `0xaF6E8f06c2c72c38D076Edc1ab2B5C2eA2bc365C`)
- `REALTIME_ENABLED` (default: `false`)
- `API_BASE_URL` (default: `""`)

## Common Issues

### Values Not Displaying After Webhook Deployment

**Problem**: After deploying via webhook, the dashboard shows incorrect or missing values.

**Cause**: Environment variables were not properly set in the deployment platform, or were set to empty values.

**Solution**: 
1. Check your deployment platform's environment variable configuration
2. Ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set
3. If you want custom addresses, set `TREASURY_ADDRESS`, `BUYBACK_ADDRESS`, etc.
4. Redeploy after updating environment variables

**Note**: The build script now handles undefined environment variables correctly by using default values instead of the string "undefined".

## Webhook Deployment Platforms

### Vercel
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add each variable with its value
4. Redeploy the project

### Netlify
1. Go to Site settings > Build & deploy > Environment
2. Add each variable under "Environment variables"
3. Trigger a new deploy

## Build Process

The build process (`npm run build:ui`) performs the following:
1. Loads environment variables from `.env` file (local) or platform environment (webhook)
2. Validates that required variables are set
3. Replaces placeholders in `web/index.html` with actual values
4. Outputs built HTML to `dist/index.html`

### Testing Locally

```bash
# Install dependencies
npm install

# Copy and configure environment file
cp .env.example .env
# Edit .env with your values

# Build the dashboard
npm run build:ui

# Serve locally for testing
npm run ui
```

## Security Notes

- **Never** commit `.env` files to the repository
- **Never** use `SUPABASE_SERVICE_ROLE_KEY` in the frontend build (only `SUPABASE_ANON_KEY`)
- The build script is designed to only inject public/anonymous keys into the HTML
