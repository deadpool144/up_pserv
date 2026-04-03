from flask import Flask, request, jsonify, session, send_file, Response
from flask_cors import CORS
import os, mimetypes
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = "secret123"

CORS(app, supports_credentials=True)

UPLOAD_FOLDER = "data"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ACCESS_KEY = os.getenv("ACCESS_KEY")

# encryption setup
if not os.path.exists("key.key"):
    with open("key.key", "wb") as f:
        f.write(Fernet.generate_key())

key = open("key.key", "rb").read()
cipher = Fernet(key)

# serve frontend
@app.route("/")
def home():
    return send_file("../frontend/index.html")

# 🔐 auth
@app.route("/auth", methods=["POST"])
def auth():
    if request.json.get("key") == ACCESS_KEY:
        session["auth"] = True
        return {"status": "ok"}
    return {"error": "wrong key"}, 401

# 📂 list files
@app.route("/files")
def files():
    if not session.get("auth"):
        return {"error": "unauthorized"}, 401

    files = []
    for f in os.listdir(UPLOAD_FOLDER):
        name = f.replace(".enc", "")
        files.append(name)

    return {"files": files}

# 📤 upload
@app.route("/upload", methods=["POST"])
def upload():
    if not session.get("auth"):
        return {"error": "unauthorized"}, 401

    file = request.files["file"]
    encrypted = cipher.encrypt(file.read())

    with open(os.path.join(UPLOAD_FOLDER, file.filename + ".enc"), "wb") as f:
        f.write(encrypted)

    return {"status": "uploaded"}

# 📥 download
@app.route("/download/<filename>")
def download(filename):
    if not session.get("auth"):
        return {"error": "unauthorized"}, 401

    path = os.path.join(UPLOAD_FOLDER, filename + ".enc")
    decrypted = cipher.decrypt(open(path, "rb").read())

    temp = "temp_" + filename
    with open(temp, "wb") as f:
        f.write(decrypted)

    return send_file(temp, as_attachment=True)

# 🎥 stream / view
@app.route("/view/<filename>")
def view(filename):
    if not session.get("auth"):
        return {"error": "unauthorized"}, 401

    path = os.path.join(UPLOAD_FOLDER, filename + ".enc")
    decrypted = cipher.decrypt(open(path, "rb").read())

    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    return Response(decrypted, mimetype=mime)

app.run(host="0.0.0.0", port=8000)