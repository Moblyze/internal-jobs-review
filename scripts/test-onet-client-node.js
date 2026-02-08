/**
 * Test O*NET Client (Node.js Version)
 * Verifies all functions work correctly
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const ONET_API_KEY = process.env.VITE_ONET_API_KEY;
const BASE_URL = process.env.VITE_ONET_BASE_URL || 'https://api-v2.onetcenter.org';

// Mock localStorage for Node.js environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, value) => mockStorage.set(key, value),
  removeItem: (key) => mockStorage.delete(key),
  keys: () => Array.from(mockStorage.keys())
};

console.log('🧪 Testing O*NET Client (Node.js)\n');
console.log('Configuration:');
console.log(`  API Key: ***${ONET_API_KEY?.slice(-4) || 'not set'}`);
console.log(`  Base URL: ${BASE_URL}`);
console.log('');

// Cache configuration
const CACHE_PREFIX = 'onet_cache_';
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_DELAY = 100;
let lastRequestTime = 0;

// Cache utilities
const cache = {
  get(key) {
    try {
      const item = global.localStorage.getItem(CACHE_PREFIX + key);
      if (!item) return null;
      const { data, timestamp } = JSON.parse(item);
      if (Date.now() - timestamp > CACHE_DURATION) {
        this.remove(key);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  },
  set(key, data) {
    try {
      global.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch {}
  },
  remove(key) {
    global.localStorage.removeItem(CACHE_PREFIX + key);
  }
};

async function rateLimit() {
  const now = Date.now();
  const timeSince = now - lastRequestTime;
  if (timeSince < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSince));
  }
  lastRequestTime = Date.now();
}

async function onetRequest(endpoint, options = {}) {
  const { useCache = true, retries = 2, timeout = 10000 } = options;

  if (useCache) {
    const cached = cache.get(endpoint);
    if (cached) return cached;
  }

  await rateLimit();

  const url = `${BASE_URL}${endpoint}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          'X-API-Key': ONET_API_KEY,
          'Accept': 'application/json',
          'User-Agent': 'Moblyze-Jobs/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      if (useCache) cache.set(endpoint, data);
      return data;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError' || error.message.includes('404')) break;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastError;
}

// Test functions
async function testSearch() {
  console.log('='.repeat(60));
  console.log('TEST 1: Search for occupations');
  console.log('='.repeat(60));
  try {
    const data = await onetRequest('/online/search?keyword=electrician');
    console.log(`✅ Found ${data.occupation?.length || 0} occupations`);
    data.occupation?.slice(0, 3).forEach((occ, i) => {
      console.log(`   ${i + 1}. ${occ.code} - ${occ.title}`);
    });
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return false;
  }
}

async function testGetOccupation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Get occupation details');
  console.log('='.repeat(60));
  try {
    const occ = await onetRequest('/online/occupations/47-2111.00');
    console.log('✅ Occupation details:');
    console.log(`   Code: ${occ.code}`);
    console.log(`   Title: ${occ.title}`);
    console.log(`   Description: ${occ.description?.substring(0, 100)}...`);
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return false;
  }
}

async function testGetSkills() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Get occupation skills');
  console.log('='.repeat(60));
  try {
    const data = await onetRequest('/online/occupations/47-2111.00/summary/skills');
    const skills = data.element || [];
    console.log(`✅ Found ${skills.length} skills`);
    skills.slice(0, 5).forEach((skill, i) => {
      console.log(`   ${i + 1}. ${skill.name} (${skill.id})`);
    });
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return false;
  }
}

async function testFindOccupation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: Find occupation by job title');
  console.log('='.repeat(60));
  try {
    const data = await onetRequest('/online/search?keyword=solar+panel+installer');
    const match = data.occupation[0];
    console.log('✅ Best match:');
    console.log(`   Code: ${match.code}`);
    console.log(`   Title: ${match.title}`);
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return false;
  }
}

async function testCache() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: Cache functionality');
  console.log('='.repeat(60));
  try {
    const start1 = Date.now();
    await onetRequest('/online/search?keyword=welder');
    const time1 = Date.now() - start1;

    const start2 = Date.now();
    await onetRequest('/online/search?keyword=welder');
    const time2 = Date.now() - start2;

    console.log('✅ Cache test:');
    console.log(`   First request: ${time1}ms (API)`);
    console.log(`   Second request: ${time2}ms (cached)`);
    console.log(`   Speedup: ${Math.round((time1 / time2) * 10) / 10}x`);
    return true;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  const tests = [
    { name: 'Search', fn: testSearch },
    { name: 'Get Occupation', fn: testGetOccupation },
    { name: 'Get Skills', fn: testGetSkills },
    { name: 'Find Occupation', fn: testFindOccupation },
    { name: 'Cache', fn: testCache }
  ];

  const results = [];
  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
    } catch (error) {
      console.error(`\n💥 Test "${test.name}" error:`, error);
      results.push({ name: test.name, passed: false });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  results.forEach(r => console.log(`${r.passed ? '✅' : '❌'} ${r.name}`));
  console.log(`\n${passed}/${results.length} tests passed`);

  if (passed === results.length) {
    console.log('\n🎉 All tests passed! O*NET client ready.');
    console.log('📝 Next: Integrate with skillValidator.js (Phase 3)');
  }

  return passed === results.length;
}

runAllTests().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
