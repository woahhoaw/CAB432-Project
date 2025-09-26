Assignment 1 - REST API Project - Response to Criteria
================================================

Overview
------------------------------------------------

- **Name:** Daniel Waterson  
- **Student number:** n11603674  
- **Application name:** Log Analyzer  
- **Two line description:** This REST API ingests and analyzes server log files. It provides summaries (unique IPs, top paths, status codes, error trends) and raw events with filters, enabling performance monitoring and security insights.  

Core criteria
------------------------------------------------

### Containerise the app

- **ECR Repository name:** n11603674-log-analyzer  
- **Video timestamp:** 00:20 - 00: 50
- **Relevant files:**  
  - `Dockerfile`  
  - `package.json`  

### Deploy the container

- **EC2 instance ID:** i-0027601bfde9881dd  
- **Video timestamp:**  00:20 - 00:50
- **Relevant files:**  
  - Deployment shown via `docker run` on EC2  

### User login

- **One line description:** JWT-based login with two user roles (`admin`, `analyst`) to secure API endpoints.  
- **Video timestamp:**  01:11, 4:52
- **Relevant files:**  
  - `auth.js`  
  - `app.js` (auth routes)  

### REST API

- **One line description:** REST API with endpoints for login, log upload, log analysis, retrieving summaries, querying events, and deleting logs.  
- **Video timestamp:**  01:10 - 01:45
- **Relevant files:**  
  - `app.js`  
  - `store.js`  
  - `analyzer.js`  

### Data types

- **One line description:** Application persists both unstructured (raw log files) and structured (JSON summaries and parsed events) data.  
- **Video timestamp:**  02:00
- **Relevant files:**  
  - `store.js`  
  - `/data/logs/` (stored .log files)  
  - `/data/db/` (JSON summaries, event metadata)  

#### First kind

- **One line description:** Raw uploaded log files stored for analysis.  
- **Type:** Unstructured data  
- **Rationale:** Required to preserve original server logs for later parsing or re-analysis.  
- **Video timestamp:**02:00  
- **Relevant files:**  
  - `/data/logs/*.log`  

#### Second kind

- **One line description:** Parsed log summaries and events saved as structured JSON.  
- **Type:** Structured data  
- **Rationale:** Enables queries for top IPs, top paths, status codes, and error trends.  
- **Video timestamp:**  
- **Relevant files:**  
  - `store.js`  
  - `/data/db/`  

### CPU intensive task

- **One line description:** Log parsing + SHA256 hashing of uploaded files; designed to push CPU load under multiple parallel requests.  
- **Video timestamp:**  02:35
- **Relevant files:**  
  - `analyzer.js` (parse + compute)  

### CPU load testing

- **One line description:** Automated `loadtest.sh` script repeatedly triggers log analysis to sustain >80% CPU usage for ~5 minutes.  
- **Video timestamp:**  
- **Relevant files:**  
  - `scripts/loadtest.sh`  

Additional criteria
------------------------------------------------

### Extensive REST API features

- **One line description:** Implemented pagination, filtering (by IP, status, time), and sorting for `/logs/:logId/events`.  
- **Video timestamp:**  
- **Relevant files:**  
  - `app.js`  
  - `store.js`  

### External API(s)

- **One line description:** Not attempted  
- **Video timestamp:**  
- **Relevant files:**  

### Additional types of data

- **One line description:** Not attempted  
- **Video timestamp:**  
- **Relevant files:**  

### Custom processing

- **One line description:** Not attempted  
- **Video timestamp:**  
- **Relevant files:**  

### Infrastructure as code

- **One line description:** Not attempted  
- **Video timestamp:**  
- **Relevant files:**  

### Web client

- **One line description:** React dashboard for login, log upload, summaries, and event browsing. Interfaces with all REST endpoints.  
- **Video timestamp:**  04:31
- **Relevant files:**  
  - `Dashboard/` (React app)  
  - `UploadForm.jsx`, `SummaryView.jsx`, `LoginForm.jsx`, `App.jsx`  

### Upon request

- **One line description:** Not attempted  
- **Video timestamp:**  
- **Relevant files:**  
