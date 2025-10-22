# ⚡ Recruit Grid

A performance-first recruitment database demo. Streams **250k+ candidates** from a FastAPI backend in **Apache Arrow** format, then does **multithreaded filtering/sorting** in a Web Worker using a **SharedArrayBuffer**, while a **virtualized React grid** renders at 60–120 FPS.

> Why: recruiter CRMs feel laggy. This project tests whether search/sort/scroll can feel instant at scale.

---

## 🚀 Highlights
- **Arrow over JSON** → tiny payloads, zero JSON parsing overhead.
- **Web Worker + SharedArrayBuffer** → filter/sort off the main thread (no jank).
- **Virtualized DOM grid** → render cost ~O(1) regardless of dataset size.
- **FastAPI** backend with a pre-generated Arrow snapshot for fast first paint.

---

## 🧩 Stack
- **Backend:** Python 3.11+, FastAPI, PyArrow  
- **Frontend:** React + TypeScript (Vite), `apache-arrow`  
- **Perf tricks:** SharedArrayBuffer, background compute, DOM virtualization

---

## �� Benchmarks (local, M1/M2 laptop)
| Operation | Result (example) |
|---|---|
| Initial load (250k rows) | ~1–2s (first run, then cached) |
| Scroll throughput | 120 fps |
| Text filter (“rust kubernetes”) | <100 ms |
| Sort change (comp desc) | <80 ms |

*(Run your own and update these numbers.)*

---

## 📦 Run locally

### 1) Backend
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python backend/gen_mock.py          # writes /tmp/candidates.arrow
uvicorn backend.app:app --reload --port 8000
