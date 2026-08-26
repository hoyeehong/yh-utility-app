# Utility App v1 (Static / Supabase)

Legacy v1 release of the Utility App featuring a client-side Next.js frontend with Supabase Authentication and Storage.

## Features
- Tariff calculations and utility consumption comparisons
- Manual bill entry and tariff breakdown
- Supabase Cloud SSO / Auth & Cloud Storage integration
- Offline LocalStorage fallback

## Local Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev
```

The app will be accessible at `http://localhost:3000`.

## Docker & Cloud Run Deployment

```bash
# Build Docker image
docker build -t utility-app-v1 .

# Run Docker container
docker run -p 3000:3000 utility-app-v1
```
