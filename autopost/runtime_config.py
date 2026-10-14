import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("FBAUTO_DATA", str(ROOT / "data")))
PORT = int(os.environ.get("FBAUTO_PORT", "8765"))
VERSION = os.environ.get("FB_GRAPH_VERSION", "v25.0")
