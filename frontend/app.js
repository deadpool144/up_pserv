const API = "http://192.168.x.x:8000";

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
  const list = document.getElementById("files");

  list.innerHTML = "";
  data.files.forEach(f => {
    const li = document.createElement("li");
    li.innerHTML = `<a href="${API}/download/${f}">${f}</a>`;
    list.appendChild(li);
  });
}