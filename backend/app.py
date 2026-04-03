from flask import Flask, request, session, jsonify
from flask_cors import CORS
import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY")

CORS(app, supports_credentials=True)

UPLOAD_FOLDER = "data"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

USERNAME = os.getenv("USERNAME")
PASSWORD = os.getenv("PASSWORD")

# key setup
if not os.path.exists("key.key"):
    with open("key.key", "wb") as f:
        f.write(Fernet.generate_key())

key = open("key.key", "rb").read()
cipher = Fernet(key)

# login
@app.route("/login", methods=["POST"])
def login():
    data = request.json
    if data["username"] == USERNAME and data["password"] == PASSWORD:
        session["logged_in"] = True
        return {"status": "ok"}
    return {"error": "invalid"}, 401

# list files
@app.route("/files")
def files():
    if not session.get("logged_in"):
        return {"error": "unauthorized"}, 401
    return {"files": os.listdir(UPLOAD_FOLDER)}

# upload
@app.route("/upload", methods=["POST"])
def upload():
    if not session.get("logged_in"):
        return {"error": "unauthorized"}, 401

    file = request.files["file"]
    encrypted = cipher.encrypt(file.read())

    with open(os.path.join(UPLOAD_FOLDER, file.filename + ".enc"), "wb") as f:
        f.write(encrypted)

    return {"status": "uploaded"}

app.run(host="0.0.0.0", port=8000)