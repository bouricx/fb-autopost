import asyncio
from .queue_storage import claim_due, finish
from .page_client import PublishError
from .discord_promote import notify

class Engine:
    def __init__(self, facebook):
        self.facebook = facebook
        self.stopped = asyncio.Event()

    async def run(self):
        while not self.stopped.is_set():
            job = claim_due()
            if job:
                try:
                    post_id = await self.facebook.publish(job)
                except PublishError as exc:
                    finish(job['id'], 'uncertain' if exc.uncertain else 'failed', error=str(exc))
                except Exception:
                    finish(job['id'], 'uncertain', error='Unexpected failure. Check the Page before retrying.')
                else:
                    finish(job['id'], 'sent', result_id=post_id)
                    await notify(post_id)
            try:
                await asyncio.wait_for(self.stopped.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass
