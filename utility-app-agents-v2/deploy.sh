#!/usr/bin/env bash
# deploy.sh — Build, push, and deploy both services to Google Cloud Run
# ─────────────────────────────────────────────────────────────────────────────
# Based on LADPE Module 4.3 Cloud Run Deployment Guide pattern.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Docker Desktop running
#   - .env file filled in (copied from .env.docker)
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh              # deploy both services
#   ./deploy.sh backend      # deploy backend only
#   ./deploy.sh frontend     # deploy frontend only
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  # Export all non-comment lines
  set -a
  source .env
  set +a
else
  echo "❌  .env file not found. Copy .env.docker → .env and fill in values."
  exit 1
fi

# ── Validate required vars ────────────────────────────────────────────────────
: "${GCP_REGION:?Set GCP_REGION in .env}"
: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT in .env}"
: "${GAR_REPO:?Set GAR_REPO in .env}"
: "${BACKEND_SERVICE_NAME:?Set BACKEND_SERVICE_NAME in .env}"
: "${FRONTEND_SERVICE_NAME:?Set FRONTEND_SERVICE_NAME in .env}"

TAG="${IMAGE_TAG:-latest}"
GAR_HOST="${GCP_REGION}-docker.pkg.dev"
GAR_BASE="${GAR_HOST}/${GOOGLE_CLOUD_PROJECT}/${GAR_REPO}"
BACKEND_IMAGE="${GAR_BASE}/${BACKEND_SERVICE_NAME}:${TAG}"
FRONTEND_IMAGE="${GAR_BASE}/${FRONTEND_SERVICE_NAME}:${TAG}"

TARGET="${1:-all}"  # all | backend | frontend

# ── Helper ────────────────────────────────────────────────────────────────────
log() { echo; echo "▶  $*"; echo; }

# ── Step 0: Enable APIs (idempotent) ─────────────────────────────────────────
log "0/6 — Enabling Cloud Run + Artifact Registry APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  --project="${GOOGLE_CLOUD_PROJECT}" --quiet

# ── Step 1: Create Artifact Registry repo if needed ──────────────────────────
log "1/6 — Ensuring Artifact Registry repository exists"
gcloud artifacts repositories describe "${GAR_REPO}" \
  --location="${GCP_REGION}" \
  --project="${GOOGLE_CLOUD_PROJECT}" \
  --quiet 2>/dev/null || \
gcloud artifacts repositories create "${GAR_REPO}" \
  --repository-format=docker \
  --location="${GCP_REGION}" \
  --description="yh-utility-app Docker images" \
  --project="${GOOGLE_CLOUD_PROJECT}" \
  --quiet

# ── Step 2: Skip local Docker auth (Cloud Build handles auth natively) ────────
log "2/6 — Skipping local Docker auth (Cloud Build builds remotely in GCP)"

# ─────────────────────────────────────────────────────────────────────────────
# BACKEND
# ─────────────────────────────────────────────────────────────────────────────
deploy_backend() {
  log "3a/6 — Building and pushing backend image via Cloud Build"
  
  cat <<EOF > /tmp/cloudbuild-backend.yaml
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-f', 'Dockerfile.backend', '-t', '${BACKEND_IMAGE}', '.']
images:
- '${BACKEND_IMAGE}'
EOF

  gcloud builds submit \
    --config=/tmp/cloudbuild-backend.yaml \
    --project="${GOOGLE_CLOUD_PROJECT}" \
    --region="${GCP_REGION}" \
    .

  rm -f /tmp/cloudbuild-backend.yaml

  log "3b/6 — Deploying backend → Cloud Run (${GCP_REGION})"
  
  # Build env vars string dynamically
  ENV_VARS="GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},GOOGLE_CLOUD_LOCATION=${GCP_REGION},LLM_MODEL=${LLM_MODEL:-gemini-3.7-flash},FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-utility-app-firestore}"
  
  [ -n "${GEMINI_API_KEY:-}" ] && ENV_VARS="${ENV_VARS},GEMINI_API_KEY=${GEMINI_API_KEY}"
  [ -n "${ANTHROPIC_API_KEY:-}" ] && ENV_VARS="${ENV_VARS},ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
  [ -n "${OPENAI_API_KEY:-}" ] && ENV_VARS="${ENV_VARS},OPENAI_API_KEY=${OPENAI_API_KEY}"
  [ -n "${GROQ_API_KEY:-}" ] && ENV_VARS="${ENV_VARS},GROQ_API_KEY=${GROQ_API_KEY}"
  [ -n "${OPENROUTER_API_KEY:-}" ] && ENV_VARS="${ENV_VARS},OPENROUTER_API_KEY=${OPENROUTER_API_KEY}"
  [ -n "${SCAN_PRIMARY_MODEL:-}" ] && ENV_VARS="${ENV_VARS},SCAN_PRIMARY_MODEL=${SCAN_PRIMARY_MODEL}"
  [ -n "${SCAN_FALLBACK_MODEL:-}" ] && ENV_VARS="${ENV_VARS},SCAN_FALLBACK_MODEL=${SCAN_FALLBACK_MODEL}"
  [ -n "${ENABLE_ARIZE_OBSERVABILITY:-}" ] && ENV_VARS="${ENV_VARS},ENABLE_ARIZE_OBSERVABILITY=${ENABLE_ARIZE_OBSERVABILITY}"
  [ -n "${ARIZE_API_KEY:-}" ] && ENV_VARS="${ENV_VARS},ARIZE_API_KEY=${ARIZE_API_KEY}"
  [ -n "${ARIZE_SPACE_ID:-}" ] && ENV_VARS="${ENV_VARS},ARIZE_SPACE_ID=${ARIZE_SPACE_ID}"
  [ -n "${ARIZE_SPACE_KEY:-}" ] && ENV_VARS="${ENV_VARS},ARIZE_SPACE_KEY=${ARIZE_SPACE_KEY}"
  [ -n "${ARIZE_PROJECT_NAME:-}" ] && ENV_VARS="${ENV_VARS},ARIZE_PROJECT_NAME=${ARIZE_PROJECT_NAME}"
  [ -n "${ARIZE_OTLP_ENDPOINT:-}" ] && ENV_VARS="${ENV_VARS},ARIZE_OTLP_ENDPOINT=${ARIZE_OTLP_ENDPOINT}"
  [ -n "${PHOENIX_COLLECTOR_ENDPOINT:-}" ] && ENV_VARS="${ENV_VARS},PHOENIX_COLLECTOR_ENDPOINT=${PHOENIX_COLLECTOR_ENDPOINT}"

  gcloud run deploy "${BACKEND_SERVICE_NAME}" \
    --image "${BACKEND_IMAGE}" \
    --platform managed \
    --region "${GCP_REGION}" \
    --port 8000 \
    --memory 2Gi \
    --cpu 2 \
    --timeout 300 \
    --concurrency 80 \
    --min-instances 0 \
    --max-instances 5 \
    --allow-unauthenticated \
    --set-env-vars "${ENV_VARS}" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --quiet

  # Capture the backend URL for use by the frontend
  BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE_NAME}" \
    --region="${GCP_REGION}" \
    --project="${GOOGLE_CLOUD_PROJECT}" \
    --format="value(status.url)")
  echo "✅  Backend deployed → ${BACKEND_URL}"
}

# ─────────────────────────────────────────────────────────────────────────────
# FRONTEND
# ─────────────────────────────────────────────────────────────────────────────
deploy_frontend() {
  # Resolve backend URL (either from previous deploy step or from live service)
  if [ -z "${BACKEND_URL:-}" ]; then
    BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE_NAME}" \
      --region="${GCP_REGION}" \
      --project="${GOOGLE_CLOUD_PROJECT}" \
      --format="value(status.url)" 2>/dev/null || echo "")
  fi

  if [ -z "${BACKEND_URL}" ]; then
    echo "❌  Backend Cloud Run URL not found. Deploy backend first."
    exit 1
  fi

  log "4a/6 — Building and pushing frontend image via Cloud Build (ADK_BACKEND_URL=${BACKEND_URL})"
  
  cat <<EOF > /tmp/cloudbuild-frontend.yaml
steps:
- name: 'gcr.io/cloud-builders/docker'
  args:
  - 'build'
  - '-f'
  - 'Dockerfile.frontend'
  - '--build-arg'
  - 'NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}'
  - '--build-arg'
  - 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}'
  - '--build-arg'
  - 'NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}'
  - '--build-arg'
  - 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}'
  - '--build-arg'
  - 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}'
  - '--build-arg'
  - 'NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}'
  - '--build-arg'
  - 'ADK_BACKEND_URL=${BACKEND_URL}'
  - '-t'
  - '${FRONTEND_IMAGE}'
  - '.'
images:
- '${FRONTEND_IMAGE}'
EOF

  gcloud builds submit \
    --config=/tmp/cloudbuild-frontend.yaml \
    --project="${GOOGLE_CLOUD_PROJECT}" \
    --region="${GCP_REGION}" \
    .

  rm -f /tmp/cloudbuild-frontend.yaml

  log "4b/6 — Deploying frontend → Cloud Run (${GCP_REGION})"
  gcloud run deploy "${FRONTEND_SERVICE_NAME}" \
    --image "${FRONTEND_IMAGE}" \
    --platform managed \
    --region "${GCP_REGION}" \
    --port 3000 \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --concurrency 100 \
    --min-instances 0 \
    --max-instances 10 \
    --allow-unauthenticated \
    --set-env-vars "NODE_ENV=production" \
    --set-env-vars "ADK_BACKEND_URL=${BACKEND_URL}" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --quiet

  FRONTEND_URL=$(gcloud run services describe "${FRONTEND_SERVICE_NAME}" \
    --region="${GCP_REGION}" \
    --project="${GOOGLE_CLOUD_PROJECT}" \
    --format="value(status.url)")
  echo "✅  Frontend deployed → ${FRONTEND_URL}"
}

# ── Step 5: Grant frontend → backend access (Cloud Run IAM) ──────────────────
grant_iam() {
  log "5/6 — Granting frontend service account access to backend"
  # The frontend Cloud Run service identity needs roles/run.invoker on the backend
  FRONTEND_SA=$(gcloud run services describe "${FRONTEND_SERVICE_NAME}" \
    --region="${GCP_REGION}" \
    --project="${GOOGLE_CLOUD_PROJECT}" \
    --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null || echo "")

  if [ -n "${FRONTEND_SA}" ]; then
    gcloud run services add-iam-policy-binding "${BACKEND_SERVICE_NAME}" \
      --region="${GCP_REGION}" \
      --project="${GOOGLE_CLOUD_PROJECT}" \
      --member="serviceAccount:${FRONTEND_SA}" \
      --role="roles/run.invoker" \
      --quiet
    echo "✅  IAM binding set: ${FRONTEND_SA} → roles/run.invoker on backend"
  else
    echo "⚠️   Could not auto-set IAM. Manually grant frontend SA roles/run.invoker on backend."
  fi
}

# ── Step 6: Summary ───────────────────────────────────────────────────────────
summary() {
  log "6/6 — Deployment summary"
  echo "  Frontend : ${FRONTEND_URL:-<not deployed this run>}"
  echo "  Backend  : ${BACKEND_URL:-<not deployed this run>}"
  echo
  echo "  Local dev : docker-compose up -d --build"
  echo "  View logs : gcloud run services logs read ${BACKEND_SERVICE_NAME} --region ${GCP_REGION}"
  echo
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "${TARGET}" in
  backend)
    deploy_backend
    summary
    ;;
  frontend)
    deploy_frontend
    grant_iam
    summary
    ;;
  all)
    deploy_backend
    deploy_frontend
    grant_iam
    summary
    ;;
  *)
    echo "Usage: ./deploy.sh [all|backend|frontend]"
    exit 1
    ;;
esac
