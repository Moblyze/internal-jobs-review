/**
 * Test different O*NET authentication methods
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const ONET_USERNAME = process.env.VITE_ONET_USERNAME;
const BASE_URL = 'https://services.onetcenter.org/ws';

console.log('Testing different O*NET authentication methods...\n');
console.log(`Username: ${ONET_USERNAME}\n`);

// Method 1: HTTP Basic Auth with username only
async function testBasicAuth() {
  console.log('Method 1: HTTP Basic Auth (username only)');
  const auth = Buffer.from(`${ONET_USERNAME}:`).toString('base64');
  const url = `${BASE_URL}/online/search?keyword=welding`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      console.log('  ✅ Success!\n');
      return true;
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }
  console.log();
  return false;
}

// Method 2: Username as query parameter
async function testQueryParam() {
  console.log('Method 2: Username as query parameter');
  const url = `${BASE_URL}/online/search?keyword=welding&username=${ONET_USERNAME}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      console.log('  ✅ Success!\n');
      return true;
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }
  console.log();
  return false;
}

// Method 3: Custom header
async function testCustomHeader() {
  console.log('Method 3: Custom X-API-Key header');
  const url = `${BASE_URL}/online/search?keyword=welding`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': ONET_USERNAME,
        'Accept': 'application/json'
      }
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      console.log('  ✅ Success!\n');
      return true;
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }
  console.log();
  return false;
}

// Method 4: Bearer token
async function testBearerToken() {
  console.log('Method 4: Bearer token');
  const url = `${BASE_URL}/online/search?keyword=welding`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ONET_USERNAME}`,
        'Accept': 'application/json'
      }
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      console.log('  ✅ Success!\n');
      return true;
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }
  console.log();
  return false;
}

// Method 5: Try the client parameter that O*NET uses
async function testClientParam() {
  console.log('Method 5: client parameter');
  const url = `${BASE_URL}/online/search?keyword=welding&client=${ONET_USERNAME}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      console.log('  ✅ Success!\n');
      const data = await response.json();
      console.log('Sample response:', JSON.stringify(data, null, 2).substring(0, 500));
      return true;
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }
  console.log();
  return false;
}

async function runTests() {
  const methods = [
    testBasicAuth,
    testQueryParam,
    testCustomHeader,
    testBearerToken,
    testClientParam
  ];

  for (const method of methods) {
    const success = await method();
    if (success) {
      console.log('🎉 Found working authentication method!');
      return;
    }
  }

  console.log('❌ None of the authentication methods worked.');
  console.log('\nPlease verify:');
  console.log('1. You registered at https://services.onetcenter.org/');
  console.log('2. You received a confirmation email with your username');
  console.log('3. Your username is active and not expired');
}

runTests();
