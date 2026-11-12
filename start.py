"""Build the UI, install local dependencies and serve UI + API on one origin."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent

def main():
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("Install Node.js 22.12+ (with npm), then run python start.py again.")
    environment = ROOT / "backend" / ".venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.create(environment, with_pip=True)
    commands = [([str(python), "-m", "pip", "install", "-r", "requirements.txt"], ROOT / "backend"),
                ([npm, "ci"], ROOT / "frontend"),
                ([npm, "run", "build"], ROOT / "frontend")]
    for command, cwd in commands:
        subprocess.run(command, cwd=cwd, check=True)
    print("Open http://127.0.0.1:8000 — Smart Caspian Transit", flush=True)
    subprocess.run([str(python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], cwd=ROOT / "backend", check=True)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
