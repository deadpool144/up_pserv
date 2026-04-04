import os
import json
import base64
import time
import secrets
import threading
from functools import wraps
from flask import Blueprint, request, jsonify, Response, send_from_directory
from config import ACCESS_KEY, TOKEN_TTL, FOLDERS, VAULT_DIR, THUMBNAIL_DIR
from crypto import get_stream_decryptor, process_chunk

api = Blueprint("api", __name__)

# ── Token store ───────────────────────────────────────────────────────────────
_tokens: dict = {}   # token → expiry_timestamp
_tlock = threading.Lock()

def _issue_token() -> str:
    token = secrets.token_urlsafe(32)
    with _tlock:
        _tokens[token] = time.time() + TOKEN_TTL
    return token

def _valid_token(req) -> bool:
    token = req.args.get("token") or req.form.get("token")
    if not token and req.is_json:
        try:
            token = req.get_json(silent=True).get("token")
        except Exception:
            pass
    if not token:
        return False
    with _tlock:
        exp = _tokens.get(token)
        if not exp:
            return False
        if time.time() > exp:
            del _tokens[token]
            return False
        return True

def token_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not _valid_token(request):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapper

# Cleanup expired tokens every 30 min
def _cleanup_tokens():
    while True:
        time.sleep(1800)
        now = time.time()
        with _tlock:
            expired = [t for t, exp in _tokens.items() if now > exp]
            for t in expired:
                del _tokens[t]
threading.Thread(target=_cleanup_tokens, daemon=True).start()

# ── Auth ──────────────────────────────────────────────────────────────────────
@api.route("/auth", methods=["POST"])
def auth():
    data = request.get_json(silent=True) or {}
    key  = data.get("key") or request.form.get("key")
    if key != ACCESS_KEY:
        return jsonify({"error": "Invalid key"}), 401
    token = _issue_token()
    return jsonify({"token": token, "expires_in": TOKEN_TTL})

@api.route("/auth", methods=["DELETE"])
@token_required
def logout():
    token = request.args.get("token")
    with _tlock:
        _tokens.pop(token, None)
    return jsonify({"status": "ok"})

@api.route("/files", methods=["GET"])
@token_required
def list_files():
    from storage import is_vault_item, get_meta
    limit  = int(request.args.get("limit", 20))
    offset = int(request.args.get("offset", 0))
    v_type = request.args.get("type", "all") # all, images, videos, files

    if not os.path.exists(VAULT_DIR):
        return jsonify({"items": [], "total": 0})
    
    # Scan categorized subfolders
    subfolders = ["images", "videos", "documents", "files"]
    detailed = []
    
    for sub in subfolders:
        sub_path = os.path.join(VAULT_DIR, sub)
        if not os.path.exists(sub_path): continue
        
        for n in os.listdir(sub_path):
            p = os.path.join(sub_path, n)
            if is_vault_item(p):
                try:
                    m = get_meta(p)
                    m["enc_name"] = n
                    detailed.append(m)
                except: continue
    
    # Also check root for legacy files (pre-restructure)
    for n in os.listdir(VAULT_DIR):
        if n in subfolders: continue
        p = os.path.join(VAULT_DIR, n)
        if is_vault_item(p):
            try:
                m = get_meta(p)
                m["enc_name"] = n
                detailed.append(m)
            except: continue

    # Sorting
    detailed.sort(key=lambda x: x.get("created_at", 0), reverse=True)

    # Filtering
    if v_type == "images":
        detailed = [d for d in detailed if "image" in d.get("type", "")]
    elif v_type == "videos":
        detailed = [d for d in detailed if "video" in d.get("type", "")]
    elif v_type == "documents":
        detailed = [d for d in detailed if any(x in d.get("type", "") for x in ["pdf", "text", "msword", "document", "spreadsheet", "presentation", "csv"])]
    elif v_type == "files":
        # 'files' now excludes images, videos, AND documents for clarity
        is_media = lambda t: "image" in t or "video" in t
        is_doc   = lambda t: any(x in t for x in ["pdf", "text", "msword", "document", "spreadsheet", "presentation", "csv"])
        detailed = [d for d in detailed if not is_media(d.get("type", "")) and not is_doc(d.get("type", ""))]

    total = len(detailed)
    page  = detailed[offset : offset + limit]
    
    res = []
    for d in page:
        res.append({
            "id":       d["enc_name"],
            "name":     d["name"],
            "size":     d["size"],
            "type":     d["type"],
            "thumb":    os.path.exists(os.path.join(THUMBNAIL_DIR, d["enc_name"])),
            "created":  d.get("created_at", 0)
        })

    return jsonify({"items": res, "total": total})

# ── Upload ────────────────────────────────────────────────────────────────────
@api.route("/upload-chunk", methods=["POST"])
@token_required
def upload_chunk():
    from storage import write_encrypted_to_file, finalize_vault_item
    from config import TMP_DIR

    chunk_file   = request.files.get("chunk")
    file_id      = request.form.get("file_id")
    chunk_index  = int(request.form.get("chunk_index", 0))
    total_chunks = int(request.form.get("total_chunks", 1))
    filename     = request.form.get("filename")
    global_offset = int(request.form.get("offset", 0))

    if not chunk_file or not file_id:
        return "Missing data", 400

    temp_dir = os.path.join(TMP_DIR, file_id)
    os.makedirs(temp_dir, exist_ok=True)
    
    state_path = os.path.join(temp_dir, ".state")
    nonce      = None
    
    if os.path.exists(state_path):
        with open(state_path, "r") as f:
            nonce = base64.b64decode(json.load(f)["nonce"])
    else:
        nonce = secrets.token_bytes(16)
        with open(state_path, "w") as f:
            json.dump({"nonce": base64.b64encode(nonce).decode()}, f)

    data = chunk_file.read()
    write_encrypted_to_file(data, nonce, global_offset, temp_dir)

    if chunk_index == total_chunks - 1:
        # Final chunk: calculate total size from last chunk end
        total_size = global_offset + len(data)
        # Finalize in background or block? For simple files, block is fine.
        finalize_vault_item(temp_dir, filename, nonce, total_size)

    return "OK"

# ── Download / Preview ────────────────────────────────────────────────────────
@api.route("/download/<enc_name>", methods=["GET"])
@token_required
def download(enc_name):
    from storage import serve_vault_stream
    return serve_vault_stream(enc_name, is_download=True)

@api.route("/preview/<enc_name>", methods=["GET"])
@token_required
def preview(enc_name):
    from storage import serve_vault_stream
    return serve_vault_stream(enc_name, is_download=False)

# ── Thumbnail Service ────────────────────────────────────────────────────────
@api.route("/thumbnail/<enc_name>", methods=["GET"])
@token_required
def get_thumbnail(enc_name):
    th_path = os.path.join(THUMBNAIL_DIR, enc_name)
    if not os.path.exists(th_path):
        return "Not found", 404
        
    def generate():
        with open(th_path, "rb") as f:
            th_nonce = f.read(16)
            dec = get_stream_decryptor(th_nonce, 0)
            while True:
                data = f.read(256 * 1024)
                if not data: break
                yield dec.update(data)
                
    return Response(generate(), mimetype="image/jpeg")

@api.route("/delete/<enc_name>", methods=["DELETE"])
@token_required
def delete_file(enc_name):
    import shutil
    from storage import find_item_path
    v_path = find_item_path(enc_name)
    t_path = os.path.join(THUMBNAIL_DIR, enc_name)
    if v_path and os.path.exists(v_path):
        shutil.rmtree(v_path)
    if os.path.exists(t_path):
        os.remove(t_path)
    return jsonify({"status": "ok"})
