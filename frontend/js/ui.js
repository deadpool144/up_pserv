import { thumbUrl, previewUrl, downloadWithProgress, deleteFile } from './api.js';

const $ = (id) => document.getElementById(id);

export function renderGrid(data, isAppend = false, onDelete) {
    const container = $("grid-container");
    if (!isAppend) container.innerHTML = "";

    data.forEach(file => {
        const card = document.createElement("div");
        card.className = "file-card";
        card.innerHTML = `
            <div class="card-thumb">
                ${file.thumb 
                    ? `<img src="${thumbUrl(file.id)}" loading="lazy" alt="">`
                    : `<div class="file-icon">${getFileIcon(file.type)}</div>`
                }
                ${file.type.includes("video") ? `
                <div class="play-overlay">
                    <div class="play-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>` : ''}
                <div class="card-actions">
                    <button class="action-btn btn-dl" title="Download">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button class="action-btn btn-del" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            <div class="card-info">
                <span class="file-name" title="${file.name}">${file.name}</span>
                <span class="file-meta">${getFileLabel(file.type)} · ${formatSize(file.size)}</span>
            </div>
        `;

        card.querySelector(".btn-dl").onclick = (e) => {
            e.stopPropagation();
            startDownload(file);
        };
        card.querySelector(".btn-del").onclick = async (e) => {
            e.stopPropagation();
            if (await deleteFile(file.id)) onDelete();
        };
        card.onclick = () => openViewer(file);

        container.appendChild(card);
    });
}

function getFileIcon(mime) {
    if (mime.includes("video")) return "🎬";
    if (mime.includes("pdf")) return "📄";
    if (mime.includes("image")) return "🖼️";
    return "📁";
}
function getFileLabel(mime) {
    if (mime.includes("video")) return "VIDEO";
    if (mime.includes("image")) return "IMAGE";
    if (mime.includes("pdf")) return "PDF";
    return "FILE";
}

function formatSize(bytes) {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

async function startDownload(file) {
    const toast = $("dl-toast");
    const bar   = $("dl-bar");
    const pct   = $("dl-pct");
    $("dl-name").textContent = file.name;
    toast.classList.remove("hidden");

    await downloadWithProgress(file.id, file.name, (sent, total) => {
        const p = total ? Math.round((sent / total) * 100) : 0;
        bar.style.width = p + "%";
        pct.textContent = p + "%";
    }, () => {
        setTimeout(() => toast.classList.add("hidden"), 2000);
    });
}

// ── Viewer ────────────────────────────────────────────────────────────────────
export function openViewer(file) {
    const viewer = $("viewer");
    const inner  = $("viewer-inner");
    viewer.classList.remove("hidden");
    inner.innerHTML = `<div class="viewer-loading">Decrypting...</div>`;

    const url = previewUrl(file.id);

    if (file.type.startsWith("image/")) {
        inner.innerHTML = `<img src="${url}" class="viewer-img" alt="">`;
    } else if (file.type === "application/pdf") {
        inner.innerHTML = `<iframe src="${url}" class="viewer-pdf"></iframe>`;
    } else {
        inner.innerHTML = `
            <div class="viewer-generic">
                ${file.thumb 
                    ? `<div class="generic-thumb-wrapper"><img src="${thumbUrl(file.id)}" class="generic-thumb" alt=""></div>`
                    : `<div class="generic-icon">${getFileIcon(file.type)}</div>`
                }
                <div class="generic-name">${file.name}</div>
                <div class="generic-meta">${getFileLabel(file.type)} · ${formatSize(file.size)}</div>
                <button class="btn-primary" onclick="window.dispatchEvent(new CustomEvent('dl-file', {detail: ${JSON.stringify(file).replace(/"/g, '&quot;')}}))">
                    Download to View
                </button>
            </div>`;
    }
}

export function closeViewer() {
    $("viewer").classList.add("hidden");
    $("viewer-inner").innerHTML = "";
}

window.addEventListener('dl-file', (e) => startDownload(e.detail));
