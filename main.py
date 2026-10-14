import sys
from autopost.config import STATE_DIR
from autopost.desktop import run_desktop, report_error

if __name__ == '__main__':
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None or sys.stderr is None:
        log = open(STATE_DIR / 'desktop-startup.log', 'a', encoding='utf-8', buffering=1)
        sys.stdout = sys.stderr = log
    try:
        run_desktop()
    except Exception as error:
        report_error(error)
        raise SystemExit(1)
