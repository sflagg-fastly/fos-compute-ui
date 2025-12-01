/// <reference types="@fastly/js-compute" />

import { Router } from "@fastly/expressly";
import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";

// -----------------------------------------------------------------------------
// 1. FRONTEND SCRIPT (served as /app.js)
// -----------------------------------------------------------------------------

const CLIENT_SCRIPT = `
/**
 * FORCE LOCALHOST
 * Redirects 127.0.0.1 to localhost to ensure consistent behavior
 */
if (window.location.hostname === '127.0.0.1') {
    window.location.hostname = 'localhost';
}

/**
 * Settings Form 
 */
const $settingsForm = document.getElementById('settingsForm');

if ($settingsForm) {
    document.getElementById('settingsForm').addEventListener('submit', function(event) {
        event.preventDefault();
        const region = document.getElementById('region').value;
        const accessKeyId = document.getElementById('accessKeyId').value;
        const secretKey = document.getElementById('secretKey').value;

        // Save to LocalStorage
        localStorage.setItem('region', region);
        localStorage.setItem('accessKeyId', accessKeyId);
        localStorage.setItem('secretKey', secretKey);
        
        alert('Parameters saved!');
    });

    document.addEventListener('DOMContentLoaded', function() {
        const savedRegion = localStorage.getItem('region');
        const savedAccessKeyId = localStorage.getItem('accessKeyId');
        const savedSecretKey = localStorage.getItem('secretKey');

        if (savedRegion) document.getElementById('region').value = savedRegion;
        if (savedAccessKeyId) document.getElementById('accessKeyId').value = savedAccessKeyId;
        if (savedSecretKey) document.getElementById('secretKey').value = savedSecretKey;
    });
}

/**
 * Helper to get Query String for credentials
 */
function getAuthQueryString() {
    const region = localStorage.getItem('region');
    const accessKeyId = localStorage.getItem('accessKeyId');
    const secretKey = localStorage.getItem('secretKey');
    
    if (!region || !accessKeyId || !secretKey) return null;

    // We encode component to ensure special characters in keys don't break the URL
    return \`region=\${encodeURIComponent(region)}&accessKeyId=\${encodeURIComponent(accessKeyId)}&secretKey=\${encodeURIComponent(secretKey)}\`;
}

/**
 * Bucket List 
 */
async function fetchBuckets() {
    const authQuery = getAuthQueryString();
    if (!authQuery) {
        if(document.getElementById('bucketList')) alert('Missing credentials.');
        return;
    }

    try {
        // Credentials in URL
        const response = await fetch(\`/s3/list-buckets?\${authQuery}\`);
        const result = await response.json();

        if (!response.ok) throw new Error(result.error || 'Failed to retrieve buckets.');

        const bucketListElement = document.getElementById('bucketList');
        if(!bucketListElement) return;
        
        bucketListElement.innerHTML = ''; 

        if (result.buckets && result.buckets.length > 0) {
            result.buckets.forEach(bucket => {
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td class="border border-gray-300 p-2"> <a href="/bucket/\${bucket.Name}" class="text-blue-600 hover:underline">\${bucket.Name}</a></td>
                    <td class="border border-gray-300 p-2">\${bucket.CreationDate ? new Date(bucket.CreationDate).toLocaleString() : 'N/A'}</td>
                    <td class="border border-gray-300 p-2">
                        <button class="deleteBucket bg-red-100 text-red-700 px-2 py-1 rounded border border-red-300 hover:bg-red-200" data-bucket="\${bucket.Name}">
                        🗑️ delete
                        </button>
                        <a href="/bucket/\${bucket.Name}" class="bg-gray-100 text-gray-700 border border-gray-300 px-2 py-1 rounded ml-2 hover:bg-gray-200">
                           View files
                        </a>
                    </td>
                \`;
                bucketListElement.appendChild(row);
            });

            document.querySelectorAll('.deleteBucket').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const bucketName = event.target.getAttribute('data-bucket');
                    await deleteBucket(bucketName);
                });
            });

        } else {
            bucketListElement.innerHTML = '<tr><td colspan="3" class="p-2 text-center">No buckets found.</td></tr>';
        }
    } catch (error) {
        console.error('Error fetching buckets:', error);
    }
}

async function deleteBucket(bucketName) {
    if (!confirm(\`Are you sure you want to delete bucket "\${bucketName}"?\`)) return;
    
    const region = localStorage.getItem('region');
    const accessKeyId = localStorage.getItem('accessKeyId');
    const secretKey = localStorage.getItem('secretKey');

    try {
        // Credentials in Body for POST/DELETE
        const response = await fetch('/s3/delete-bucket', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucketName, region, accessKeyId, secretKey })
        });

        const result = await response.json();
        if (response.ok) {
            alert(result.message);
            await fetchBuckets();
        } else {
            alert(result.error);
        }
    } catch (error) {
        console.error('Error deleting bucket:', error);
        alert('An error occurred.');
    }
}

const $bucketList = document.getElementById('bucketList');
if ($bucketList) {
    document.addEventListener('DOMContentLoaded', fetchBuckets);
    document.getElementById('refreshBuckets').addEventListener('click', fetchBuckets);
}

const $createBucketForm = document.getElementById('createBucketForm');
if ($createBucketForm) {
    document.getElementById('createBucketForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const bucketName = document.getElementById('bucketName').value.toLowerCase();
        
        const region = localStorage.getItem('region');
        const accessKeyId = localStorage.getItem('accessKeyId');
        const secretKey = localStorage.getItem('secretKey');

        if (!bucketName) return alert('Bucket name required.');

        try {
            // Credentials in Body
            const response = await fetch('/s3/create-bucket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketName, region, accessKeyId, secretKey }),
            });
            const result = await response.json();
            if (response.ok) {
                await fetchBuckets();
                alert(result.message);
                document.getElementById('modalOverlay').classList.add('hidden');
            } else {
                alert(result.error);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred.');
        }
    });
}

const $modalOverlay = document.getElementById('modalOverlay');
if ($modalOverlay) {
    const modalOverlay = document.getElementById('modalOverlay');
    document.getElementById('openModal').addEventListener('click', () => modalOverlay.classList.remove('hidden'));
    document.getElementById('closeModal').addEventListener('click', () => modalOverlay.classList.add('hidden'));
    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) modalOverlay.classList.add('hidden');
    });
}

// Upload & List
const $uploadForm = document.getElementById('uploadForm');
if ($uploadForm) {
    const pathParts = window.location.pathname.split('/');
    const bucketName = pathParts[pathParts.length - 1];
    document.querySelectorAll('.bucketName').forEach(el => el.innerText = bucketName);

    document.getElementById('uploadForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const fileInput = document.getElementById('fileInput');
        if (!fileInput.files.length) return showMessage('Select a file.', 'bg-red-200 text-red-800');

        const authQuery = getAuthQueryString();
        if (!authQuery) return showMessage('Missing credentials.', 'bg-red-200 text-red-800');

        const file = fileInput.files[0];
        
        // Pass file metadata in Query, file content as body
        const uploadQuery = \`\${authQuery}&fileName=\${encodeURIComponent(file.name)}&contentType=\${encodeURIComponent(file.type || 'application/octet-stream')}\`;

        try {
            showMessage('Uploading...', 'bg-blue-200 text-blue-800');
            // Credentials in URL for Upload too
            const response = await fetch(\`/s3/bucket/\${bucketName}?\${uploadQuery}\`, {
                method: 'POST',
                body: file 
            });

            const result = await response.json();
            if (response.ok) {
                showMessage(result.message, 'bg-green-200 text-green-800');
                await fetchBucketFiles(); 
            } else {
                showMessage(result.error || 'Upload failed.', 'bg-red-200 text-red-800');
            }
        } catch (error) {
            console.error('Error uploading:', error);
            showMessage('Error uploading file.', 'bg-red-200 text-red-800');
        }
    });
}

function showMessage(message, className) {
    const messageBox = document.getElementById('messageBox');
    messageBox.innerText = message;
    messageBox.className = \`mt-4 p-2 text-center rounded \${className}\`;
    messageBox.classList.remove('hidden');
}

function getBucketNameFromURL() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1];
}

async function fetchBucketFiles() {
    const bucketName = getBucketNameFromURL();
    const bucketNameEl = document.getElementById('bucketName');
    if(bucketNameEl) bucketNameEl.textContent = bucketName;

    const authQuery = getAuthQueryString();
    if (!authQuery) return;

    try {
        // Credentials in URL
        const response = await fetch(\`/s3/bucket/\${bucketName}?\${authQuery}\`);
        const result = await response.json();

        if (!response.ok) throw new Error(result.error || 'Failed to retrieve files.');

        const fileListElement = document.getElementById('fileList');
        if(!fileListElement) return;
        fileListElement.innerHTML = '';

        if (result.files && result.files.length > 0) {
            result.files.forEach(file => {
                // Construct view link with credentials embedded (so it works on click)
                const viewLink = \`/s3/bucket/\${bucketName}/\${file.Key}?\${authQuery}\`;
                
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td class="border border-gray-300 p-2"> <a href="\${viewLink}" target="_blank" class="text-blue-600 hover:underline">\${file.Key}</a></td>
                    <td class="border border-gray-300 p-2">\${file.LastModified ? new Date(file.LastModified).toLocaleString() : 'N/A'}</td>
                    <td class="border border-gray-300 p-2 text-center">\${file.Size}</td>
                    <td class="border border-gray-300 p-2 text-center">
                        <a href="\${viewLink}" target="_blank" class="text-indigo-600 hover:text-indigo-900">
                           View
                        </a>
                    </td>
                    \`;
                fileListElement.appendChild(row);
            });
        } else {
            fileListElement.innerHTML = '<tr><td colspan="4" class="p-2 text-center">No files found.</td></tr>';
        }
    } catch (error) {
        console.error('Error fetching files:', error);
    }
}

const $fileList = document.getElementById('fileList');
if($fileList){
    document.addEventListener('DOMContentLoaded', fetchBucketFiles);
    document.getElementById('refreshFiles').addEventListener('click', fetchBucketFiles);
}
`;

// -----------------------------------------------------------------------------
// 2. HTML TEMPLATES 
// -----------------------------------------------------------------------------

function renderLayout(title, body) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com/3.4.13"></script>
</head>
<body class="bg-gray-100 min-h-screen">
  <nav class="bg-white shadow sticky top-0 z-50">
    <div class="container mx-auto px-4 py-3 flex justify-between items-center">
      <div class="flex items-center">
        <a class="ml-3 text-xl font-semibold text-gray-800" href="/">
          <span class="">Fastly Object Storage</span> <span class="font-light"> easy UI (Compute)</span>
        </a>
      </div>
    </div>
  </nav>
  ${body}
  <script src="/app.js"></script>
</body>
</html>
  `;
}

function renderIndex() {
  const html = `
<form id="settingsForm" class="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow-md mt-6">
    <h2 class="text-xl font-bold mb-4">Fastly Object Storage credentials</h2>
    <div class="mb-4">
        <label for="region" class="block text-sm font-medium text-gray-700">Region</label>
        <select id="region" name="region" class="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm">
            <option value="eu-central">eu-central</option>
            <option value="us-east">us-east</option>
            <option value="us-west">us-west</option>
        </select>
    </div>
    <div class="mb-4">
        <label for="accessKeyId" class="block text-sm font-medium text-gray-700">Access Key ID</label>
        <input type="text" id="accessKeyId" name="accessKeyId" class="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm">
    </div>
    <div class="mb-6">
        <label for="secretKey" class="block text-sm font-medium text-gray-700">Secret Key</label>
        <input type="password" id="secretKey" name="secretKey" class="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm">
    </div>
    <button type="submit" class="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600">Save Parameters</button>
</form>
<div id="modalOverlay" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden">
    <div class="bg-white p-6 rounded-lg shadow-lg max-w-md w-full relative">
        <button id="closeModal" class="absolute top-2 right-2 text-gray-600 hover:text-gray-800">&times;</button>
        <h2 class="text-xl font-bold mb-4">Create a New Bucket</h2>
        <form id="createBucketForm" class="mb-4">
            <div class="mb-4">
                <label for="bucketName" class="block text-sm font-medium text-gray-700">Bucket Name</label>
                <input type="text" id="bucketName" name="bucketName" class="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm">
            </div>
            <button type="submit" class="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600">Create Bucket</button>
        </form>
    </div>
</div>
<div class="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow-md mt-6">
    <h2 class="text-xl font-bold mb-4">Your buckets</h2>
    <div class="flex gap-2 mb-4">
      <button id="refreshBuckets" class="border border-indigo-600 p-2 rounded-md hover:bg-indigo-50">Refresh List</button>
      <button id="openModal" class="border border-indigo-600 px-4 py-2 rounded-md hover:bg-indigo-50">Create Bucket</button>
    </div>
    <table class="w-full mt-4 border-collapse border border-gray-300">
        <thead>
            <tr class="bg-gray-100">
                <th class="border border-gray-300 p-2">Bucket Name</th>
                <th class="border border-gray-300 p-2">Creation Date</th>
                <th class="border border-gray-300 p-2">Actions</th>
            </tr>
        </thead>
        <tbody id="bucketList"></tbody>
    </table>
</div>
  `;
  return renderLayout("Fastly Object Storage UI", html);
}

function renderBucketPage(bucketName) {
  const html = `
<div class="max-w-4xl mx-auto bg-white p-6 rounded-lg shadow-md mt-6">
    <h2 class="text-xl font-bold mb-4">Upload File to Bucket</h2>
    <p class="text-gray-700 mb-2"><strong>Bucket:</strong> <span class="bucketName font-semibold text-blue-600"></span></p>
    <form id="uploadForm" class="mb-4">
        <input type="file" id="fileInput" class="w-full p-2 border border-gray-300 rounded-md mb-4" required>
        <button type="submit" class="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600">Upload File</button>
    </form>
    <div id="messageBox" class="mt-4 p-2 text-center hidden"></div>
</div>
<div class="max-w-4xl mx-auto bg-white p-6 rounded-lg shadow-md mt-6">
    <h2 class="text-2xl font-bold mb-4">Bucket Files</h2>
    <div class="flex gap-2 mb-4">
        <button id="refreshFiles" class="border border-indigo-600 p-2 rounded-md hover:bg-indigo-50">Refresh List</button>
    </div>
    <div class="overflow-x-auto">
        <table class="w-full border-collapse border border-gray-300">
            <thead>
                <tr class="bg-gray-100">
                    <th class="border border-gray-300 p-2">File Name</th>
                    <th class="border border-gray-300 p-2">Last Modified</th>
                    <th class="border border-gray-300 p-2">Size (Bytes)</th>
                    <th class="border border-gray-300 p-2">Action</th>
                </tr>
            </thead>
            <tbody id="fileList"></tbody>
        </table>
    </div>
</div>
  `;
  // *** changed here: no template literal for title ***
  return renderLayout("Bucket: " + bucketName, html);
}

// -----------------------------------------------------------------------------
// 3. FOS (Fastly Object Storage) CLIENT (S3-compatible, Compute-friendly)
// -----------------------------------------------------------------------------

const xmlParser = new XMLParser({ ignoreAttributes: false });

function makeFosClient(region, accessKeyId, secretKey) {
  return new AwsClient({
    accessKeyId,
    secretAccessKey: secretKey,
    service: "s3",
    region,
  });
}

function fosEndpoint(region) {
  return `https://${region}.object.fastlystorage.app`;
}

// Encode key segments but preserve path slashes
function encodeS3Key(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function fosListBuckets(region, accessKeyId, secretKey) {
  const aws = makeFosClient(region, accessKeyId, secretKey);
  const res = await aws.fetch(`${fosEndpoint(region)}/`, { method: "GET" });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ListBuckets failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  const parsed = xmlParser.parse(text);
  const raw =
    (parsed &&
      parsed.ListAllMyBucketsResult &&
      parsed.ListAllMyBucketsResult.Buckets &&
      parsed.ListAllMyBucketsResult.Buckets.Bucket) ||
    (parsed && parsed.Buckets && parsed.Buckets.Bucket) ||
    [];

  const buckets = Array.isArray(raw) ? raw : [raw];

  return buckets
    .filter((b) => b && b.Name !== undefined)
    .map((b) => ({
      Name: b.Name,
      CreationDate: b.CreationDate,
    }));
}

async function fosCreateBucket(region, accessKeyId, secretKey, bucketName) {
  const aws = makeFosClient(region, accessKeyId, secretKey);
  const res = await aws.fetch(`${fosEndpoint(region)}/${bucketName}`, {
    method: "PUT",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `CreateBucket failed: ${res.status} ${res.statusText} – ${text}`
    );
  }
}

async function fosDeleteBucket(region, accessKeyId, secretKey, bucketName) {
  const aws = makeFosClient(region, accessKeyId, secretKey);
  const res = await aws.fetch(`${fosEndpoint(region)}/${bucketName}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `DeleteBucket failed: ${res.status} ${res.statusText} – ${text}`
    );
  }
}

async function fosListObjects(region, accessKeyId, secretKey, bucketName) {
  const aws = makeFosClient(region, accessKeyId, secretKey);
  const res = await aws.fetch(
    `${fosEndpoint(region)}/${bucketName}?list-type=2`,
    { method: "GET" }
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ListObjectsV2 failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  const parsed = xmlParser.parse(text);
  const raw =
    (parsed && parsed.ListBucketResult && parsed.ListBucketResult.Contents) ||
    [];

  const contents = Array.isArray(raw) ? raw : [raw];

  return contents
    .filter((obj) => obj && obj.Key !== undefined)
    .map((obj) => ({
      Key: obj.Key,
      LastModified: obj.LastModified,
      Size: Number(obj.Size || 0),
    }));
}

async function fosPutObject(
  region,
  accessKeyId,
  secretKey,
  bucketName,
  key,
  body,
  contentType
) {
  const aws = makeFosClient(region, accessKeyId, secretKey);
  const res = await aws.fetch(
    `${fosEndpoint(region)}/${bucketName}/${encodeS3Key(key)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `PutObject failed: ${res.status} ${res.statusText} – ${text}`
    );
  }
}

async function fosGetObject(region, accessKeyId, secretKey, bucketName, key) {
  const aws = makeFosClient(region, accessKeyId, secretKey);
  const res = await aws.fetch(
    `${fosEndpoint(region)}/${bucketName}/${encodeS3Key(key)}`,
    { method: "GET" }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GetObject failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  return res;
}

// -----------------------------------------------------------------------------
// 4. ROUTER / SERVER LOGIC
// -----------------------------------------------------------------------------

const router = new Router();

// -- Pages --

router.get("/", (req, res) => {
  res.headers.set("Content-Type", "text/html");
  res.send(renderIndex());
});

router.get("/app.js", (req, res) => {
  res.headers.set("Content-Type", "application/javascript");
  res.send(CLIENT_SCRIPT);
});

router.get("/bucket/:bucketName", (req, res) => {
  res.headers.set("Content-Type", "text/html");
  res.send(renderBucketPage(req.params.bucketName));
});

// -- API: Buckets --

router.post("/s3/create-bucket", async (req, res) => {
  let body = {};
  try {
    body = await req.json();
  } catch (e) {
    // ignore
  }

  const bucketName = body.bucketName;
  const region = body.region;
  const accessKeyId = body.accessKeyId;
  const secretKey = body.secretKey;

  if (!bucketName || !region || !accessKeyId || !secretKey) {
    res.status = 400;
    return res.json({ error: "Missing required fields or credentials" });
  }

  try {
    await fosCreateBucket(region, accessKeyId, secretKey, bucketName);
    res.json({ message: "Bucket '" + bucketName + "' created successfully." });
  } catch (error) {
    console.error("CreateBucket error:", error);
    res.status = 500;
    res.json({ error: String(error && error.message ? error.message : error) });
  }
});

router.get("/s3/list-buckets", async (req, res) => {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") || "";
  const accessKeyId = url.searchParams.get("accessKeyId") || "";
  const secretKey = url.searchParams.get("secretKey") || "";

  if (!region || !accessKeyId || !secretKey) {
    res.status = 400;
    return res.json({ error: "Missing credentials" });
  }

  try {
    const buckets = await fosListBuckets(region, accessKeyId, secretKey);
    res.json({ buckets });
  } catch (error) {
    console.error("ListBuckets error:", error);
    res.status = 500;
    res.json({ error: String(error && error.message ? error.message : error) });
  }
});

router.delete("/s3/delete-bucket", async (req, res) => {
  let body = {};
  try {
    body = await req.json();
  } catch (e) {
    // ignore
  }

  const bucketName = body.bucketName;
  const region = body.region;
  const accessKeyId = body.accessKeyId;
  const secretKey = body.secretKey;

  if (!bucketName || !region || !accessKeyId || !secretKey) {
    res.status = 400;
    return res.json({ error: "Missing data" });
  }

  try {
    await fosDeleteBucket(region, accessKeyId, secretKey, bucketName);
    res.json({ message: "Bucket '" + bucketName + "' deleted." });
  } catch (error) {
    console.error("DeleteBucket error:", error);
    res.status = 500;
    res.json({ error: String(error && error.message ? error.message : error) });
  }
});

// -- API: Objects --

router.get("/s3/bucket/:bucketName", async (req, res) => {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") || "";
  const accessKeyId = url.searchParams.get("accessKeyId") || "";
  const secretKey = url.searchParams.get("secretKey") || "";

  if (!region || !accessKeyId || !secretKey) {
    res.status = 400;
    return res.json({ error: "Missing credentials" });
  }

  try {
    const files = await fosListObjects(
      region,
      accessKeyId,
      secretKey,
      req.params.bucketName
    );
    res.json({ bucket: req.params.bucketName, files });
  } catch (error) {
    console.error("ListObjects error:", error);
    res.status = 500;
    res.json({ error: String(error && error.message ? error.message : error) });
  }
});

router.post("/s3/bucket/:bucketName", async (req, res) => {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") || "";
  const accessKeyId = url.searchParams.get("accessKeyId") || "";
  const secretKey = url.searchParams.get("secretKey") || "";
  const fileName = url.searchParams.get("fileName") || "";
  const contentType =
    url.searchParams.get("contentType") || "application/octet-stream";

  if (!region || !accessKeyId || !secretKey || !fileName) {
    res.status = 400;
    return res.json({ error: "Missing info" });
  }

  try {
    const buf = await req.arrayBuffer();
    const fileBuffer = new Uint8Array(buf);

    await fosPutObject(
      region,
      accessKeyId,
      secretKey,
      req.params.bucketName,
      fileName,
      fileBuffer,
      contentType
    );

    res.json({ message: "File uploaded." });
  } catch (error) {
    console.error("Upload error:", error);
    res.status = 500;
    res.json({ error: String(error && error.message ? error.message : error) });
  }
});

router.get("/s3/bucket/:bucketName/:key", async (req, res) => {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") || "";
  const accessKeyId = url.searchParams.get("accessKeyId") || "";
  const secretKey = url.searchParams.get("secretKey") || "";

  if (!region || !accessKeyId || !secretKey) {
    res.status = 400;
    return res.send("Missing credentials.");
  }

  try {
    const awsRes = await fosGetObject(
      region,
      accessKeyId,
      secretKey,
      req.params.bucketName,
      req.params.key
    );

    const ct = awsRes.headers.get("content-type");
    const cl = awsRes.headers.get("content-length");
    if (ct) res.headers.set("Content-Type", ct);
    if (cl) res.headers.set("Content-Length", cl);

    const buf = await awsRes.arrayBuffer();
    res.send(new Uint8Array(buf));
  } catch (error) {
    console.error("GetObject error:", error);
    res.status = 500;
    res.send("Error retrieving file.");
  }
});

// -----------------------------------------------------------------------------
// 5. START
// -----------------------------------------------------------------------------

router.listen();
