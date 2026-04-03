const API = "http://192.168.x.x:8000"; // CHANGE THIS

async function login() {
  const key = document.getElementById("key").value;

  const res = await fetch(API + "/auth", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({key}),
    credentials: "include"
  });

  if (res.ok) {
    document.getElementById("vault").style.display = "block";
    loadFiles();
  } else {
    alert("Wrong key");
  }
}

async function upload() {
  const file = document.getElementById("file").files[0];
  const formData = new FormData();
  formData.append("file", file);

  await fetch(API + "/upload", {
    method: "POST",
    body: formData,
    credentials: "include"
  });

  loadFiles();
}

async function loadFiles() {
  const res = await fetch(API + "/files", {
    credentials: "include"
  });

  const data = await res.json();
  const container = document.getElementById("files");

  container.innerHTML = "";

  data.files.forEach(file => {
    const div = document.createElement("div");

    const url = API + "/view/" + file;

    // image preview
    if (file.match(/\.(jpg|png|jpeg|gif)$/i)) {
      div.innerHTML += `<img src="${url}">`;
    }

    // video preview
    else if (file.match(/\.(mp4|webm)$/i)) {
      div.innerHTML += `<video controls src="${url}"></video>`;
    }

    div.innerHTML += `
      <p>${file}</p>
      <a href="${API}/download/${file}">Download</a>
      <hr>
    `;

    container.appendChild(div);
  });
}