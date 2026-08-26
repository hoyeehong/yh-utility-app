# Utility App v2 (Agentic Microservices)

Production-ready v2 release of the Utility App featuring Next.js frontend, Python FastAPI / Google Agent Development Kit (ADK) backend, Multi-Model LLMs (Gemini, Claude, GPT), and Arize Phoenix Observability.

## Architecture

- **Frontend (`utility-frontend`)**: Next.js 12 (React 18) application with Firebase Cloud SSO and Firestore / Cloud Storage sync.
- **Backend (`utility-adk-backend`)**: Python 3.11 FastAPI / ADK service running multi-modal OCR bill scanning, tool-augmented calculation engines, and evaluation suites.
- **Observability (`utility-phoenix`)**: Arize Phoenix container for LLM tracing, spans, latency, and agent evaluations.

## Local Development Orchestration

Start all microservices locally with Docker Compose:

```bash
# Copy and configure environment variables
cp .env.docker .env
# Fill in your API keys in .env

# Start all containers in background
docker-compose up -d --build

# View logs
docker-compose logs -f backend
```

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000`
- **Phoenix Dashboard**: `http://localhost:6006`

## Automated Deployment to Google Cloud Run

Deploy both the frontend and backend services to GCP Cloud Run using the deployment script:

```bash
# 1. Authenticate with GCP
gcloud auth login
gcloud auth configure-docker <YOUR_REGION>-docker.pkg.dev

# 2. Deploy both services
chmod +x deploy.sh
./deploy.sh all

# Or deploy individually:
./deploy.sh backend
./deploy.sh frontend
```
