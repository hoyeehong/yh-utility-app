# Utility App Monorepo

This repository contains two evolutions of the Singapore SP Services / Electricity Tariff Comparison & Utility Tracking Application.

---

## Directory Overview

```text
yh-utility-app/
├── utility-app-static-v1/     # Legacy v1: Static Next.js frontend with Supabase integration
└── utility-app-agents-v2/     # Current v2: Multi-agent Next.js + Python ADK Backend + Cloud Run deploy
```

## 🚀 Live Deployments

- **v2 (Current - Multi-Agent & OCR):** [https://utility-frontend-294296399024.asia-southeast1.run.app](https://utility-frontend-294296399024.asia-southeast1.run.app)
- **v1 (Legacy - Static App):** [https://utility-app-static-v1.vercel.app](https://utility-app-static-v1.vercel.app)

---

## Versions & Comparison

| Feature | [utility-app-static-v1](./utility-app-static-v1/) | [utility-app-agents-v2](./utility-app-agents-v2/) |
| :--- | :--- | :--- |
| **Live URL** | [yh-utility-app-static-v1.vercel.app](https://yh-utility-app-static-v1.vercel.app) | [utility-frontend-294296399024.asia-southeast1.run.app](https://utility-frontend-294296399024.asia-southeast1.run.app) |
| **Release Type** | Legacy Baseline (v1.0) | Production Microservices (v2.0) |
| **Architecture** | Single-tier static Next.js app | Two-tier: Next.js frontend + Python ADK backend |
| **Authentication & Storage** | Supabase Auth & Storage | Firebase Cloud SSO & Cloud Firestore / Storage |
| **AI Capabilities** | Client-side calculations | Multi-Model Agent (Gemini, Claude, GPT), OCR bill scanner |
| **Observability & Evals** | N/A | Arize Phoenix traces, spans, and eval suites |
| **Deployment Target** | Single Container / Static Host | Dual Google Cloud Run services via `deploy.sh` |

---

## Quick Start

### Running v2 (Agentic App)
```bash
cd utility-app-agents-v2
cp .env.docker .env
# Edit .env with your GCP / LLM credentials
docker-compose up -d --build
```
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Phoenix Dashboard: `http://localhost:6006`

### Running v1 (Static App)
```bash
cd utility-app-static-v1
npm install
npm run dev
```
- Accessible at `http://localhost:3000`

---

## Google Cloud Run Deployment
To deploy the full Agentic system to Google Cloud Run, follow the guide inside [`utility-app-agents-v2/deploy.sh`](./utility-app-agents-v2/deploy.sh):
```bash
cd utility-app-agents-v2
./deploy.sh all
```
