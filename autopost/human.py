"""Platform layer: human-like input timing, bezier mouse moves, gentle scrolling."""
from __future__ import annotations

import asyncio
import math
import random


def pick_delay(lo, hi) -> float:
    try:
        lo = float(lo or 0)
        hi = float(hi or 0)
    except (TypeError, ValueError):
        lo = hi = 0.0
    if hi < lo:
        lo, hi = hi, lo
    if hi <= 0:
        return 0.0
    return random.uniform(lo, hi)


def typing_delay() -> float:
    return random.uniform(0.03, 0.14)


async def _bezier(p0, p1, p2, p3, t: float):
    u = 1 - t
    x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
    y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
    return x, y


async def human_click(page, locator, jitter: float = 3.0):
    """เลื่อนเมาส์เป็นเส้นโค้งเข้าเป้าแล้วคลิก — กัน teleport click แบบบอท"""
    box = await locator.bounding_box()
    if not box:
        await locator.click()
        return
    tx = box["x"] + box["width"] * random.uniform(0.3, 0.7)
    ty = box["y"] + box["height"] * random.uniform(0.3, 0.7)
    sx, sy = random.uniform(0, max(1, box["x"] - 10)), random.uniform(0, max(1, box["y"] - 10))
    c1 = (sx + (tx - sx) * 0.3 + random.uniform(-40, 40), sy + random.uniform(-40, 40))
    c2 = (tx + random.uniform(-40, 40), ty + (sy - ty) * 0.3 + random.uniform(-40, 40))
    steps = random.randint(14, 26)
    for i in range(steps + 1):
        x, y = await _bezier((sx, sy), c1, c2, (tx, ty), i / steps)
        await page.mouse.move(x + random.uniform(-jitter, jitter), y + random.uniform(-jitter, jitter))
        await asyncio.sleep(random.uniform(0.008, 0.02))
    await asyncio.sleep(random.uniform(0.03, 0.1))
    await page.mouse.down()
    await asyncio.sleep(random.uniform(0.02, 0.07))
    await page.mouse.up()
    await asyncio.sleep(random.uniform(0.05, 0.15))


async def human_scroll(page, distance: int | None = None, direction: str = "down",
                       steps: int | None = None):
    distance = distance if distance is not None else random.randint(300, 700)
    steps = steps if steps is not None else random.randint(3, 8)
    sign = -1 if direction == "down" else 1
    per = sign * max(40, distance // max(1, steps))
    for _ in range(steps):
        await page.mouse.wheel(0, per + random.randint(-30, 30))
        await asyncio.sleep(random.uniform(0.05, 0.18))


async def sleep_chunks(total: float, stopped) -> bool:
    """นอนเป็นชิ้น ๆ คืน True = ถูกสั่งหยุดกลางทาง"""
    end = asyncio.get_event_loop().time() + max(0.0, float(total))
    while True:
        if stopped is not None and stopped.is_set():
            return True
        now = asyncio.get_event_loop().time()
        if now >= end:
            return False
        await asyncio.sleep(min(0.5, end - now))


def ease_out_scroll(distance: int) -> int:
    return int(math.log2(max(2, distance)) * 100)
