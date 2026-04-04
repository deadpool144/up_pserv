import os
import json
import base64
import mimetypes
import shutil
import time
import re
import secrets
import string
from flask import request, Response
from crypto import process_chunk, get_stream_decryptor
from config import VAULT_DIR, VAULT_IMAGES, VAULT_VIDEOS, VAULT_FILES, THUMBNAIL_DIR, TMP_DIR

def save_meta(folder: str, meta: dict):
    with open(os.path.join(folder, "meta.json"), "w") as f:
        json.dump(meta, f)

def get_meta(folder: str) -> dict:
    with open(os.path.join(folder, "meta.json"), "r") as f:
        return json.load(f)

def is_vault_item(path: str) -> bool:
    return os.path.isdir(path) and os.path.exists(os.path.join(path, "meta.json"))

def vault_data_path(folder: str) -> str:
    # Look for monolithic file first, then legacy c0000.dat
    monolith = os.path.join(folder, "data.enc")
    if os.path.exists(monolith): return monolith
    legacy = os.path.join(folder, "c0000.dat")
    if os.path.exists(legacy): return legacy
    return monolith # default to monolith for new writes

def find_item_path(enc_name: str) -> str:
    """Helper to locate an encrypted folder in any vault subfolder."""
    for sub in ["images", "videos", "documents", "files"]:
        p = os.path.join(VAULT_DIR, sub, enc_name)
        if is_vault_item(p): return p
    # Fallback to root vault (for old files before restructure)
    p_root = os.path.join(VAULT_DIR, enc_name)
    if is_vault_item(p_root): return p_root
    return None

def write_encrypted_to_file(data: bytes, nonce: bytes, global_offset: int, folder: str):
    """Appends/Writes encrypted data to the single monolithic file."""
    encrypted = process_chunk(data, nonce, global_offset)
    dp = vault_data_path(folder)
    mode = "r+b" if os.path.exists(dp) else "wb"
    with open(dp, mode) as f:
        f.seek(global_offset)
        f.write(encrypted)

def finalize_vault_item(temp_dir, original_name, nonce, total_size):
    """Moves temp upload to the correct vault subfolder with metadata."""
    enc_name = os.path.basename(temp_dir)
    mime = mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    
    # ── RANDOMIZE FILENAME ──────────────────────────────────────────────────
    ext = os.path.splitext(original_name)[1]
    rand_base = ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    random_name = f"vault_{rand_base}{ext}"
    
    # Determine correct subfolder
    sub = "files"
    if mime.startswith("image/"): sub = "images"
    elif mime.startswith("video/"): sub = "videos"
    elif any(d in mime for d in ["pdf", "text", "msword", "document", "spreadsheet", "presentation", "csv"]):
        sub = "documents"
    
    final_dir = os.path.join(VAULT_DIR, sub, enc_name)
    os.makedirs(os.path.dirname(final_dir), exist_ok=True)
    
    meta = {
        "name":        random_name,
        "original":    original_name,
        "size":        total_size,
        "nonce":       base64.b64encode(nonce).decode(),
        "type":        mime,
        "created_at":  time.time()
    }
    save_meta(temp_dir, meta)
    
    state_path = os.path.join(temp_dir, ".state")
    if os.path.exists(state_path): os.remove(state_path)
    
    if os.path.exists(final_dir): shutil.rmtree(final_dir)
    os.rename(temp_dir, final_dir)
    
    # Generate thumbnail
    if mime.startswith("image/") or mime.startswith("video/"):
        generate_thumbnail(enc_name)

def generate_thumbnail(enc_name):
    """Generates a mid-quality, encrypted thumbnail (image or video). 600px/75%."""
    from PIL import Image
    import io
    
    vault_item_path = find_item_path(enc_name)
    if not vault_item_path: return
    
    meta = get_meta(vault_item_path)
    nonce = base64.b64decode(meta["nonce"])
    dp = vault_data_path(vault_item_path)
    if not os.path.exists(dp): return
    
    mime = meta.get("type", "")
    thumb_bytes = None
    
    if mime.startswith("image/"):
        thumb_bytes = _extract_image_thumb(dp, nonce)
    elif mime.startswith("video/"):
        thumb_bytes = _extract_video_thumb(dp, nonce, enc_name)
        
    if thumb_bytes:
        # Store encrypted thumbnail
        th_path = os.path.join(THUMBNAIL_DIR, enc_name)
        th_nonce = secrets.token_bytes(16)
        with open(th_path, "wb") as tf:
            tf.write(th_nonce + process_chunk(thumb_bytes, th_nonce, 0))

def _extract_image_thumb(dp, nonce):
    from PIL import Image
    import io
    # Decrypt first 50MB
    with open(dp, "rb") as f:
        enc_data = f.read(50 * 1024 * 1024)
        dec = get_stream_decryptor(nonce, 0)
        raw_data = dec.update(enc_data)
        
    try:
        img = Image.open(io.BytesIO(raw_data))
        img.thumbnail((600, 600))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=75)
        return out.getvalue()
    except Exception as e:
        print(f"[Vault] Image thumb failed: {e}")
        return None

def _extract_video_thumb(dp, nonce, enc_name):
    import cv2
    import numpy as np
    from PIL import Image
    import io
    
    # Decrypt first 20MB to a temporary file for OpenCV to read
    temp_vid = os.path.join(TMP_DIR, f"th_tmp_{enc_name}")
    try:
        with open(dp, "rb") as f:
            enc_header = f.read(20 * 1024 * 1024)
            dec = get_stream_decryptor(nonce, 0)
            raw_header = dec.update(enc_header)
            with open(temp_vid, "wb") as tv:
                tv.write(raw_header)
        
        cap = cv2.VideoCapture(temp_vid)
        # Try to seek to skip potential black frames at start (1 second)
        cap.set(cv2.CAP_PROP_POS_MSEC, 1000)
        success, frame = cap.read()
        if not success:
            # Fallback to first frame
            cap.set(cv2.CAP_PROP_POS_MSEC, 0)
            success, frame = cap.read()
            
        cap.release()
        if os.path.exists(temp_vid): os.remove(temp_vid)
        
        if success:
            # Convert BGR (CV2) to RGB (PIL)
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(frame_rgb)
            img.thumbnail((600, 600))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=75)
            return out.getvalue()
            
    except Exception as e:
        if os.path.exists(temp_vid): os.remove(temp_vid)
        print(f"[Vault] Video thumb failed: {e}")
    return None

def serve_vault_stream(enc_name: str, is_download=False):
    """Stream monolithic vault item with HTTP Range support."""
    folder = find_item_path(enc_name)
    if not folder: return "Not found", 404
    
    meta          = get_meta(folder)
    dp            = vault_data_path(folder)
    if not os.path.exists(dp): return "No data", 404

    total_size    = meta["size"]
    original_name = meta["name"]
    nonce         = base64.b64decode(meta["nonce"])
    
    range_header = request.headers.get("Range")
    start, end   = 0, total_size - 1
    status_code  = 200

    if range_header:
        m = re.search(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            # Only cap range if it's a video (for performance). For images/others, 
            # serve the full remaining file if end is not provided.
            if "video" in mime:
                default_end = min(start + 32*1024*1024 - 1, total_size - 1)
            else:
                default_end = total_size - 1
                
            end = int(m.group(2)) if m.group(2) else default_end
            end = min(end, total_size - 1)
        status_code = 206

    length = end - start + 1

    def generate():
        remaining = length
        print(f"[Stream] Starting {mime} ({original_name}), Range: {start}-{end}, Length: {length}")
        try:
            with open(dp, "rb") as f:
                f.seek(start)
                dec = get_stream_decryptor(nonce, start)
                while remaining > 0:
                    chunk_to_read = min(remaining, 4*1024*1024)
                    data = f.read(chunk_to_read)
                    if not data: 
                        print(f"[Stream] Unexpected EOF! Needed {remaining} more bytes.")
                        break
                    
                    out = dec.update(data)
                    yield out
                    remaining -= len(data)
                
                # Force clean-up
                try: dec.finalize()
                except: pass
                print(f"[Stream] Finished {original_name} successfully.")
        except Exception as e:
            print(f"[Stream] Failed during {original_name}: {e}")

    mime = meta["type"]
    headers = {
        "Content-Length": str(length),
        "Accept-Ranges":  "bytes",
        "Content-Type":   mime,
        "Cache-Control":  "no-cache",
    }
    if is_download:
        safe = original_name.replace('"', "_")
        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"
    
    return Response(generate(), status=status_code, headers=headers)
