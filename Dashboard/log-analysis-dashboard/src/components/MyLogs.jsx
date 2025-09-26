import { useEffect, useState } from "react";
import { apiFetch } from "../api";

export default function MyLogs({ onSelectLog }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    apiFetch("/logs").then(setLogs).catch(() => setLogs([]));
  }, []);

  return (
    <div className="page-container">
      <h2>My Uploaded Logs</h2>
      {logs.length === 0 ? (
        <p>No logs uploaded yet.</p>
      ) : (
        <table border="1" cellPadding="8" cellSpacing="0" style={{ width: "100%", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Uploaded At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.logId}>
                <td>{log.filename}</td>
                <td>{new Date(log.uploadedAt).toLocaleString()}</td>
                <td>
                  <button onClick={() => onSelectLog(log.logId)}>View Summary</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
