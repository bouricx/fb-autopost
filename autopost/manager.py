import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse
from .queue_storage import connection, now

def validate(page_id, message, link, scheduled_at):
    if not page_id.isdigit():
        raise ValueError('Page ID must be numeric.')
    message = message.strip()
    if not message or len(message) > 10000:
        raise ValueError('Message must contain 1–10000 characters.')
    link = link.strip()
    if link:
        parsed = urlparse(link)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username:
            raise ValueError('Link must be an HTTPS URL without credentials.')
    date = datetime.fromisoformat(scheduled_at.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('Schedule must include timezone.')
    return page_id, message, link, date.astimezone(timezone.utc).isoformat()

def create(page_id, message, link, scheduled_at):
    values = validate(page_id, message, link, scheduled_at)
    job_id = str(uuid.uuid4())
    with connection() as db:
        db.execute('INSERT INTO jobs(id,page_id,message,link,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                   (job_id, *values, 'queued', now(), now()))
    return job_id

def update(job_id, **values):
    checked = validate(**values)
    with connection() as db:
        result = db.execute("UPDATE jobs SET page_id=?,message=?,link=?,scheduled_at=?,updated_at=? WHERE id=? AND status='queued'", (*checked, now(), job_id))
        if result.rowcount != 1:
            raise ValueError('Only a queued job can be edited.')

def transition(job_id, action):
    with connection() as db:
        if action == 'cancel':
            result = db.execute("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=? AND status='queued'", (now(), job_id))
        elif action == 'retry':
            result = db.execute("UPDATE jobs SET status='queued',scheduled_at=?,updated_at=?,error='' WHERE id=? AND status IN ('failed','uncertain','cancelled')", (now(), now(), job_id))
        else:
            raise ValueError('Unknown action.')
        if result.rowcount != 1:
            raise ValueError('Job state does not allow this action.')
