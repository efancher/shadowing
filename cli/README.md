# shadowmine

Desktop CLI that downloads source audio (via yt-dlp), processes subtitles, mines Japanese lines, clips AAC/M4A references, and exports `.shadowing.zip` packages for the practice web app.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
shadowmine --help
```

Requires external `ffmpeg` and `ffprobe` on `PATH`.
