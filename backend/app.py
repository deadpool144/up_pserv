from flask import Flask, request, jsonify, session, send_file
from flask_cors import CORS
import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = "sessionsecret"

CORS(app, supports_credentials=True)

UPLOAD_FOLDER = "data"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ACCESS_KEY = os.getenv("ACCESS_KEY")

# encryption key
if not os.path.exists("key.key"):
    with open("key.key", "wb") as f:
        f.write(Fernet.generate_key())

key = open("key.key", "rb").read()
cipher = Fernet(key)

# 🔓 key login
@app.route("/auth", methods=["POST"])
def auth():
    data = request.json
    if data.get("key") == ACCESS_KEY:
        session["auth"] = True
        return {"status": "ok"}
    return {"error": "invalid key"}, 401

# 📂 list files
@app.route("/files")
def files():
    if not session.get("auth"):
        return {"error": "unauthorized"}, 401
    return {"files": os.listdir(UPLOAD_FOLDER)}

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

    path = os.path.join(UPLOAD_FOLDER, filename)
    decrypted = cipher.decrypt(open(path, "rb").read())

    temp = "temp_" + filename.replace(".enc", "")
    with open(temp, "wb") as f:
        f.write(decrypted)

    return send_file(temp, as_attachment=True)

# 🏠 home
@app.route("/")
def home():
    return "Vault Server Running"

app.run(host="0.0.0.0", port=8000)