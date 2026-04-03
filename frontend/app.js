const API = "http://192.168.x.x:8000";

async function login() {
  await fetch(API + "/login", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      username: document.getElementById("user").value,
      password: document.getElementById("pass").value
    }),
    credentials: "include"
  });

  loadFiles();
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
    li.innerText = f;
    list.appendChild(li);
  });
}