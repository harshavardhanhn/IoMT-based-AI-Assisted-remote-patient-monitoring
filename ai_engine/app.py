"""Default launcher for the complete three-layer AI engine.

The backend calls ``/ai/analyze``. The implementation lives in ``Python``;
this launcher keeps the documented ``cd ai_engine && python app.py`` command
while ensuring model paths resolve from the Python service directory.
"""

import os
import sys

SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Python"))
sys.path.insert(0, SERVICE_DIR)
os.chdir(SERVICE_DIR)

from ai_engine import app


if __name__ == "__main__":
    app.run(port=5000, debug=False)
