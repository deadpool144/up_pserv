import { login, logout, setToken, getToken, fetchFiles, uploadFile } from './api.js';
import { renderGrid, closeViewer } from './ui.js';

// ── State ──────────────────────────────────────────────────────────────────────
let activeView = "all";
let offset = 0;
const LIMIT = 40;
let totalItems = 0;
let loading = false;

const $ = (id) => document.getElementById(id);

// ── Boot ───────────────────────────────────────────────────────────────────────
const savedToken = sessionStorage.getItem("sv3_token");
if (savedToken) {
    setToken(savedToken);
    showApp();
    loadFiles();
} else {
    $("auth-screen").classList.remove("hidden");
}

// ── Auth ───────────────────────────────────────────────────────────────────────
async function tryLogin(key) {
    if (!key) return;
    $("auth-error").classList.add("hidden");
    $("login-text").classList.add("hidden");
    $("login-spinner").classList.remove("hidden");
    $("btn-login").disabled = true;

    try {
        const token = await login(key);
        if (token) {
            setToken(token);
            sessionStorage.setItem("sv3_token", token);
            showApp();
            loadFiles();
        } else {
            $("auth-error").classList.remove("hidden");
        }
    } finally {
        $("login-text").classList.remove("hidden");
        $("login-spinner").classList.add("hidden");
        $("btn-login").disabled = false;
    }
}

function showApp() {
    $("auth-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
}

function handleLogout() {
    logout();
    sessionStorage.removeItem("sv3_token");
    $("app-screen").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("key-input").value = "";
}

$("btn-login").onclick  = () => tryLogin($("key-input").value.trim());
$("key-input").onkeydown = (e) => { if (e.key === "Enter") tryLogin($("key-input").value.trim()); };
$("btn-logout").onclick = handleLogout;

// ── Navigation ─────────────────────────────────────────────────────────────────
function setView(view) {
    activeView = view;
    const labels = { all: "All Files", videos: "Videos", images: "Images", files: "Files" };
    $("section-title").textContent = labels[view] || view;
    document.querySelectorAll(".nav-btn").forEach(btn =>
        btn.classList.toggle("active", btn.dataset.view === view)
    );
    loadFiles(); // Reset and reload
}

document.querySelectorAll(".nav-btn").forEach(btn =>
    btn.addEventListener("click", () => setView(btn.dataset.view))
);

// ── File loading (Infinite Scroll) ──────────────────────────────────────────────
async function loadFiles(isAppend = false) {
    if (loading) return;
    loading = true;
    
    if (!isAppend) offset = 0;
    
    try {
        const data = await fetchFiles(offset, LIMIT, activeView);
        renderGrid(data.items, isAppend, () => loadFiles());
        totalItems = data.total;
        offset += data.items.length;
        
        const label = totalItems === 1 ? "1 item" : `${totalItems} items`;
        $("file-count").textContent = label;
    } catch (e) {
        if (e.message === "auth") handleLogout();
    } finally {
        loading = false;
    }
}

// Infinite scroll sensor
window.addEventListener("scroll", () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        if (offset < totalItems) loadFiles(true);
    }
});

// ── Upload modal ───────────────────────────────────────────────────────────────
let selectedFile = null;

function openUpload() {
    selectedFile = null;
    $("file-input").value = "";
    $("drop-label").textContent = "Tap to select file";
    $("upload-progress").classList.add("hidden");
    $("modal-actions").classList.remove("hidden");
    $("btn-start-upload").disabled = true;
    $("drop-zone").classList.remove("hidden");
    $("upload-modal").classList.remove("hidden");
}

function closeUpload() {
    $("upload-modal").classList.add("hidden");
    selectedFile = null;
}

function onFileSelected(file) {
    if (!file) return;
    selectedFile = file;
    $("drop-label").textContent = file.name;
    $("btn-start-upload").disabled = false;
}

$("btn-upload-desktop")?.addEventListener("click", openUpload);
$("btn-upload-mobile")?.addEventListener("click", openUpload);
$("btn-cancel-upload").addEventListener("click", closeUpload);
$("upload-modal").addEventListener("click", (e) => { if (e.target === $("upload-modal")) closeUpload(); });
$("file-input").addEventListener("change", () => onFileSelected($("file-input").files[0]));

// Drag & drop
const dropZone = $("drop-zone");
dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop",      (e) => {
    e.preventDefault(); dropZone.classList.remove("drag-over");
    onFileSelected(e.dataTransfer.files[0]);
});

// SVG gradient for ring
document.addEventListener("DOMContentLoaded", () => {
    const svg = document.querySelector(".ring");
    if (svg) {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        defs.innerHTML = `<linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#8b5cf6"/>
            <stop offset="100%" stop-color="#06b6d4"/>
        </linearGradient>`;
        svg.prepend(defs);
    }
}, { once: true });

// ── Upload execution ───────────────────────────────────────────────────────────
const RING_CIRC = 213.6;
$("btn-start-upload").addEventListener("click", async () => {
    if (!selectedFile) return;

    $("drop-zone").classList.add("hidden");
    $("modal-actions").classList.add("hidden");
    $("upload-progress").classList.remove("hidden");
    $("upload-filename").textContent = selectedFile.name;

    const ringFill = $("ring-fill");
    const ringPct  = $("ring-pct");
    const speedEl  = $("upload-speed");

    const ok = await uploadFile(selectedFile, (sent, total, t0) => {
        const pct  = total ? Math.round((sent / total) * 100) : 0;
        const mbps = ((sent / 1024 / 1024) / ((Date.now() - t0) / 1000)).toFixed(1);
        ringFill.style.strokeDashoffset = RING_CIRC - (RING_CIRC * pct / 100);
        ringPct.textContent  = pct + "%";
        speedEl.textContent  = mbps + " MB/s";
    });

    if (ok) {
        ringFill.style.strokeDashoffset = 0;
        ringPct.textContent = "✓";
        setTimeout(() => { closeUpload(); loadFiles(); }, 800);
    } else {
        alert("Upload failed.");
        closeUpload();
    }
});

$("btn-close-viewer").addEventListener("click", closeViewer);
$("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) closeViewer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeViewer(); closeUpload(); } });
