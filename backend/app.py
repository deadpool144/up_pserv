import os
import sys
from flask import Flask
from config import init_folders, ROOT_DIR

init_folders()

FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.register_blueprint(__import__("routes").api, url_prefix="/api")

@app.route("/")
def serve_index():
    return app.send_static_file("index.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")

    try:
        from waitress import serve
        from resources import compute_http_threads
        http_threads = compute_http_threads(min_threads=2)
        # auto-sized: cpu_count // 2  (4 threads on 8-core Helio X10)
        print(f"[Server] Waitress on {host}:{port} — {http_threads} threads "
              f"({os.cpu_count()} CPU cores detected)")
        serve(app, host=host, port=port, threads=http_threads,
              channel_timeout=600, recv_bytes=65536)
    except ImportError:
        print(f"[Server] Flask dev mode on {host}:{port}")
        app.run(host=host, port=port, debug=False, threaded=True)
