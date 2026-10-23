# Five-Minute TrustVault Demo Script

Use only synthetic files and the local seeded accounts. This is a script for a future demo, not evidence that a demo recording exists.

1. **0:00–0:40 — Sign in.** Explain the DocumentOwner, Viewer, and Administrator roles.
2. **0:40–1:30 — Upload.** As the owner, upload a small TXT file as Private. Show that it is stored outside the public directory.
3. **1:30–2:15 — Share.** Grant the Viewer Read permission. Sign in as the Viewer and show the document appears.
4. **2:15–3:00 — Permission boundary.** View the document inline. Demonstrate that the Download endpoint rejects the Read-only grant.
5. **3:00–3:45 — Revocation.** Revoke the grant as the owner and show the Viewer can no longer open the content on the next request.
6. **3:45–4:30 — Public discovery and request.** Upload a second document with Public visibility. Show that the Viewer can discover metadata but must request Read or Download access.
7. **4:30–5:00 — Audit.** Sign in as Administrator and show recent audit metadata and local chain verification.

Use the actual current interface and test results. Do not claim a step passed if it has not been run in the demo environment.
