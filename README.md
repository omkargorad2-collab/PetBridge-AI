# PawConnect AI 🐾

A responsive React + FastAPI platform for **verified** pet adoption listings, adoption requests, NGO/owner accounts, lost-and-found reporting, and optional image classification.

## Important transparency
- **No fake adoptable animals are preloaded.** The adoption page starts empty until genuine listings are submitted and an administrator verifies them.
- NGO names in the directory are **not official partnerships**. Confirm contact details and seek permission before claiming affiliation.
- AI is **optional**: image identification needs a Hugging Face token and an available inference model. Breed guesses are not proof; **age and health cannot be reliably inferred from an image**.
- Lost/found matching is **not automatic** in this MVP. Users can browse reports; similarity matching and owner contact workflow require future implementation.
- This is a deployable **MVP**, not a production security audit. Do not use it for sensitive personal information without further security and privacy work.

## Local run
### Backend (Python 3.11+)
```bash
cd backend
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env  # Windows: copy .env.example .env
# Set variables in .env or in your shell (the backend automatically reads backend/.env)
uvicorn main:app --reload --port 8000
```
API docs: http://localhost:8000/docs

### Frontend (Node.js 20+)
```bash
cd frontend
npm install
npm run dev
```
Visit http://localhost:5173

## GitHub upload
Extract ZIP, create a new GitHub repository, upload the **contents** of `pawconnect` (frontend/, backend/, render.yaml, README.md). Never commit `.env` or secrets.

## Render deployment
1. Push to GitHub.
2. Render → New → Blueprint → select repo with `render.yaml` OR New Web Service, Root Directory `backend`, Build `pip install -r requirements.txt`, Start `uvicorn main:app --host 0.0.0.0 --port $PORT`.
3. Set `JWT_SECRET` to a strong random value, `ADMIN_EMAILS` to the email of your administrator account, and `CORS_ORIGINS` to your actual Vercel URL.
4. **Persistent database and images:** Render's default filesystem is ephemeral. Configure a managed Postgres `DATABASE_URL` and persistent object storage for uploaded photos before accepting real listings. Current local upload implementation is suitable for development only; Render restarts can delete images. For a real launch, implement cloud storage (S3/Cloudinary) and update `/api/upload`.
5. Optional: set `HF_TOKEN` for AI image classification; inference availability depends on the provider/model.

## Vercel deployment
1. Vercel → Add New Project → import the same GitHub repo.
2. Root Directory: `frontend`.
3. Framework Preset: Vite; Build: `npm run build`; Output: `dist`.
4. Add environment variable `VITE_API_URL=https://YOUR-RENDER-URL.onrender.com` (no trailing slash).
5. Deploy, then update Render `CORS_ORIGINS` with your Vercel URL and redeploy backend.

## Admin verification
Register normally with the email configured in `ADMIN_EMAILS`. In Dashboard, pending pet submissions appear for that email. Verify real animal availability, owner consent, and authenticity **outside the app** before approving. Role `ngo` is self-declared; it does not imply verified NGO identity.

## Production readiness checklist
- Managed Postgres; cloud photo storage; backups
- Verified NGO identity and consent; moderation workflow; audit trail
- Secure contact messaging and privacy/consent policies
- Abuse prevention, email verification, password reset, rate limits, malware/file checks
- Lost-pet reporting review and actual AI photo similarity implementation
- Adoption follow-up and verified status updates
- Review applicable animal welfare and sale regulations; prioritize adoption

## API
`GET /api/health`, `/api/pets`, `/api/lost`; `POST /api/register`, `/api/login`, `/api/upload`, `/api/identify`, `/api/pets`, `/api/applications`, `/api/lost`; user dashboard and admin routes. Swagger at `/docs`.
