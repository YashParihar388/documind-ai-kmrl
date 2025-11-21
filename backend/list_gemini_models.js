import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY not set. Please add it to backend/.env or set environment variable.');
  process.exit(1);
}

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: '/v1beta/models',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
};

console.log('Calling ListModels endpoint...');

const req = https.request(options, (res) => {
  let data = '';
  console.log('Status:', res.statusCode);
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('ListModels response:');
      console.log(JSON.stringify(json, null, 2));
    } catch (err) {
      console.error('Failed to parse response:', err);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e);
});

req.end();

// If the above returned 401 (invalid auth for Bearer token), some Google endpoints
// accept an API key via the `key=` query parameter. Try that as a fallback and
// print its result — this helps diagnose whether your value is an API key vs an
// OAuth access token / service account credential.

req.on('close', () => {
  // no-op
});

// Also provide a quick helper to try the key query approach if the Bearer attempt fails.
function tryKeyQuery() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
  console.log('\nRetrying ListModels with ?key=API_KEY...');
  https.get(url, (res) => {
    let data = '';
    console.log('Status (key param):', res.statusCode);
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log('ListModels (key param) response:');
        console.log(JSON.stringify(json, null, 2));
      } catch (err) {
        console.error('Failed to parse response (key param):', err);
        console.log('Raw response:', data);
      }
    });
  }).on('error', (e) => {
    console.error('Request error (key param):', e);
  });
}

// Wait a moment then prompt user to run the key-query retry if needed.
console.log('\nIf you see a 401 above, try running the same script again but set your API key type appropriately.');
console.log('You can also run the key-query test manually:');
console.log('  node list_gemini_models_key.js (or run the same file after modifying to call tryKeyQuery())');
