import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from .runtime_config import DATA

def now():
    return datetime.now(timezone.utc).isoformat()

@contextmanager
def connection():
    DATA.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DATA / "queue.sqlite3", timeout=15)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

def init():
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
            message TEXT NOT NULL, link TEXT NOT NULL DEFAULT '',
            scheduled_at TEXT NOT NULL, status TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            result_id TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS due_jobs ON jobs(status, scheduled_at);
        """)
        # A crash may follow a successful remote post: do not publish twice.
        db.execute("UPDATE jobs SET status='uncertain', error=?, updated_at=? WHERE status='running'",
                   ("Process stopped during publishing. Check the Page before retrying.", now()))

def list_jobs():
    with connection() as db:
        return [dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY scheduled_at DESC LIMIT 500")]

def claim_due():
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE status='queued' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1", (now(),)).fetchone()
        if not row:
            return None
        db.execute("UPDATE jobs SET status='running',updated_at=? WHERE id=?", (now(), row['id']))
        return dict(row)

def finish(job_id, status, result_id='', error=''):
    with connection() as db:
        db.execute("UPDATE jobs SET status=?,result_id=?,error=?,updated_at=? WHERE id=? AND status='running'",
                   (status, result_id, error[:500], now(), job_id))
