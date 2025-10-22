# Rapid Recruitment Web Table

A performance-first recruitment database demo. Streams **250k+ candidates** from a FastAPI backend in **Apache Arrow** format, then does **multithreaded filtering/sorting** in a Web Worker using a **SharedArrayBuffer**, while a **virtualized React grid** renders at 60–120 FPS.

> Why: recruiter CRMs feel laggy. This project tests whether search/sort/scroll can feel instant at scale.

---

## Highlights
- **Arrow over JSON** → tiny payloads, zero JSON parsing overhead.
- **Web Worker + SharedArrayBuffer** → filter/sort off the main thread (no jank).
- **Virtualized DOM grid** → render cost ~O(1) regardless of dataset size.
- **FastAPI** backend with a pre-generated Arrow snapshot for fast first paint.

---

## Stack
- **Backend:** Python 3.11+, FastAPI, PyArrow  
- **Frontend:** React + TypeScript (Vite), `apache-arrow`  
- **Perf tricks:** SharedArrayBuffer, background compute, DOM virtualization

---

## Benchmarks (local, M1/M2 laptop)
| Operation | Result (example) |
|---|---|
| Initial load (250k rows) | ~1–2s (first run, then cached) |
| Scroll throughput | 120 fps |
| Text filter (“rust kubernetes”) | <100 ms |
| Sort change (comp desc) | <80 ms |

*(Run your own and update these numbers.)*

---

## Run locally

### 1) Backend
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python backend/gen_mock.py          # writes /tmp/candidates.arrow
uvicorn backend.app:app --reload --port 8000
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

### How it works (short)
1) Backend generates candidates and serves a binary Arrow stream at /candidates.arrow.
2) Frontend fetches Arrow, extracts typed columns.
3) A Web Worker maintains an index buffer in a SharedArrayBuffer; filtering/sorting rewrites index order without copying rows.
4) A virtualized grid renders just the visible rows → smooth 60–120 fps.

### Architecture
FastAPI (PyArrow) ──► Arrow IPC stream ──► Browser
                                       ├─► Web Worker (filters/sorts indices in SAB)
                                       └─► React Virtual Grid (renders visible slice)
### Notes / Trade-offs
For prod SAB, you need COOP/COEP headers (Vite dev server is configured).
Region latency matters for initial fetch; precompute & CDN the Arrow snapshot.
Text search is simple substring now; can upgrade to tokenized/full-text later.

### Roadmap / Ideas
Postgres/Neon path with indexed server-side /search and nightly Arrow export
Saved searches + CSV export + Import for new Data Sets
FPS counter + basic perf telemetry
Docker Compose for one-command run

### Ethics
Mock data only. If you source real profiles, handle consent, rate limits, and deletion requests responsibly.
