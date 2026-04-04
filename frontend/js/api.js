const API = "/api";
let _token = null;

export const setToken  = (t) => { _token = t; };
export const getToken  = () => _token;

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(key) {
    const res = await fetch(`${API}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
    });
    if (!res.ok) return null;
    const { token } = await res.json();
    return token;
}

export async function logout() {
    if (!_token) return;
    try { await fetch(`${API}/auth?token=${_token}`, { method: "DELETE" }); } catch (_) {}
    _token = null;
}

// ── Files (Paginated) ─────────────────────────────────────────────────────────
export async function fetchFiles(offset = 0, limit = 40, type = "all") {
    const res = await fetch(`${API}/files?token=${_token}&offset=${offset}&limit=${limit}&type=${type}`);
    if (!res.ok) throw new Error("auth");
    return res.json();
}

// ── Thumbnail URL ─────────────────────────────────────────────────────────────
export function thumbUrl(encName) {
    return `${API}/thumbnail/${encName}?token=${_token}`;
}

// ── Preview URL (decrypted stream) ────────────────────────────────────────────
export function previewUrl(encName) {
    return `${API}/preview/${encName}?token=${_token}`;
}

// ── Download ──────────────────────────────────────────────────────────────────
export async function downloadWithProgress(encId, displayName, onProgress, onDone, onError) {
    const url = `${API}/download/${encId}?token=${_token}`;

    if (window.showSaveFilePicker) {
        try {
            const handle   = await window.showSaveFilePicker({ suggestedName: displayName });
            const writable = await handle.createWritable();
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const total  = parseInt(response.headers.get("Content-Length") || "0", 10);
            const reader = response.body.getReader();
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                await writable.write(value);
                received += value.length;
                onProgress && onProgress(received, total);
            }
            await writable.close();
            onDone && onDone();
            return;
        } catch (e) {
            if (e.name === "AbortError") return;
        }
    }
    // Fallback: direct open
    onProgress && onProgress(0, 0);
    window.open(url, "_blank");
    setTimeout(() => onDone && onDone(), 800);
}

// ── Delete ────────────────────────────────────────────────────────────────────
export async function deleteFile(encName) {
    if (!confirm("Permanently delete this file?")) return false;
    const res = await fetch(`${API}/delete/${encName}?token=${_token}`, { method: "DELETE" });
    return res.ok;
}

// ── Upload (chunked, 4 MB chunks) ─────────────────────────────────────────────
export async function uploadFile(file, onProgress) {
    const CHUNK   = 4 * 1024 * 1024;
    const total   = Math.ceil(file.size / CHUNK);
    const fileId  = "ul_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    let   sent    = 0;
    const t0      = Date.now();

    for (let i = 0; i < total; i++) {
        const start = i * CHUNK;
        const end   = Math.min(start + CHUNK, file.size);
        const form  = new FormData();
        form.append("chunk",        file.slice(start, end));
        form.append("file_id",      fileId);
        form.append("chunk_index",  i);
        form.append("total_chunks", total);
        form.append("filename",     file.name);
        form.append("offset",       start);
        
        let ok = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetch(`${API}/upload-chunk?token=${_token}`, { method: "POST", body: form });
                if (!res.ok) throw new Error(res.status);
                ok = true; break;
            } catch (e) {
                if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
            }
        }
        if (!ok) return false;
        sent += end - start;
        onProgress && onProgress(sent, file.size, t0);
    }
    return true;
}
