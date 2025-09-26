import { useState } from "react";
import { getToken, apiFetch } from "../api";

export default function UploadForm({ onUpload }) {
  const [file, setFile] = useState(null);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    const token = getToken();
    if (!token) { alert("Please log in"); return; }

    // 1) get pre-signed URL
    const { url, key, logId } = await apiFetch("/logs/upload-url");

    // 2) PUT to S3 directly
    const putRes = await fetch(url, { method: "PUT", body: file });
    if (!putRes.ok) { alert("S3 upload failed"); return; }

    // 3) register upload (metadata)
    await apiFetch("/logs/register-upload", {
      method: "POST",
      body: JSON.stringify({ logId, key, filename: file.name, size: file.size })
    });

    // 4) start analysis
    await apiFetch(`/logs/${logId}/analyze`, { method: "POST" });

    onUpload?.(logId);
  }

  return (
    <div className="page-container">
      <h2>Upload Log File</h2>
      <form onSubmit={handleUpload}>
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <button type="submit" style={{ marginTop: "1rem" }}>Upload</button>
      </form>
    </div>
  );
}
