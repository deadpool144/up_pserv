import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

SECRET_KEY = os.getenv("SECRET_KEY", "fallback_dev_key")
ACCESS_KEY = os.getenv("ACCESS_KEY", "admin")
TOKEN_TTL  = int(os.getenv("TOKEN_TTL", "7200"))   # 2 hours

DATA_DIR      = os.path.join(ROOT_DIR, "data")
VAULT_DIR     = os.path.join(DATA_DIR, "vault")
VAULT_IMAGES  = os.path.join(VAULT_DIR, "images")
VAULT_VIDEOS  = os.path.join(VAULT_DIR, "videos")
VAULT_DOCS    = os.path.join(VAULT_DIR, "documents")
VAULT_FILES   = os.path.join(VAULT_DIR, "files")
THUMBNAIL_DIR  = os.path.join(DATA_DIR, "thumbnails")
TMP_DIR       = os.path.join(DATA_DIR, "tmp")

FOLDERS = {
    "vault":      VAULT_DIR,
    "images":     VAULT_IMAGES,
    "videos":     VAULT_VIDEOS,
    "documents":  VAULT_DOCS,
    "files":      VAULT_FILES,
    "thumbnails": THUMBNAIL_DIR,
    "tmp":        TMP_DIR,
}

def init_folders():
    for path in FOLDERS.values():
        os.makedirs(path, exist_ok=True)
