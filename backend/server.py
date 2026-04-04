from waitress import serve
from app import app
import os
from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 SecurVault 2.0 Production Server (Waitress) starting on port {port}...")
    print(f"🔹 Mode: Multi-Threaded (Threads=12)")
    print(f"🔹 Ready for 1GB+ high-performance mobile streaming.")
    
    # Run with 12 threads to handle multiple concurrent range requests from mobile
    serve(app, host='0.0.0.0', port=port, threads=12, channel_timeout=120)
