/**
 * O*NET API Connection Test
 * Tests O*NET Web Services API credentials and explores response format
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const ONET_API_KEY = process.env.VITE_ONET_API_KEY;
const BASE_URL = process.env.VITE_ONET_BASE_URL || 'https://api-v2.onetcenter.org';

if (!ONET_API_KEY) {
  console.error('❌ Error: VITE_ONET_API_KEY not found in .env file');
  process.exit(1);
}

console.log('🔐 O*NET API v2.0 Credentials loaded');
console.log(`📍 Base URL: ${BASE_URL}`);
console.log(`🔑 API Key: ${ONET_API_KEY.substring(0, 4)}...${ONET_API_KEY.substring(ONET_API_KEY.length - 4)}\n`);

/**
 * Make authenticated request to O*NET API
 */
async function onetRequest(endpoint) {
  const url = `${BASE_URL}${endpoint}`;

  console.log(`📡 Request: ${endpoint}`);

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': ONET_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Moblyze-Jobs/1.0'
      }
    });

    console.log(`📊 Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`❌ Request failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test 1: Search for a common skill
 */
async function testSkillSearch() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Search for "welding" skill');
  console.log('='.repeat(60));

  try {
    const data = await onetRequest('/online/search?keyword=welding');
    console.log('✅ Success! Found occupations:');

    if (data.occupation && data.occupation.length > 0) {
      data.occupation.slice(0, 5).forEach((occ, i) => {
        console.log(`  ${i + 1}. ${occ.code} - ${occ.title}`);
      });
      console.log(`\n📈 Total results: ${data.occupation.length}`);
    } else {
      console.log('⚠️  No occupations found');
    }

    return data;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return null;
  }
}

/**
 * Test 2: Get occupation details
 */
async function testOccupationDetails(code = '51-4121.00') {
  console.log('\n' + '='.repeat(60));
  console.log(`TEST 2: Get details for occupation ${code} (Welders)`);
  console.log('='.repeat(60));

  try {
    const data = await onetRequest(`/online/occupations/${code}`);
    console.log('✅ Success! Occupation details:');
    console.log(`  Code: ${data.code}`);
    console.log(`  Title: ${data.title}`);
    console.log(`  Description: ${data.description?.substring(0, 100)}...`);

    return data;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return null;
  }
}

/**
 * Test 3: Get skills for an occupation
 */
async function testOccupationSkills(code = '51-4121.00') {
  console.log('\n' + '='.repeat(60));
  console.log(`TEST 3: Get skills for occupation ${code}`);
  console.log('='.repeat(60));

  try {
    const data = await onetRequest(`/online/occupations/${code}/summary/skills`);
    console.log('✅ Success! Skills found:');

    if (data.element && data.element.length > 0) {
      data.element.slice(0, 10).forEach((skill, i) => {
        console.log(`  ${i + 1}. ${skill.name} (${skill.id})`);
        console.log(`     Level: ${skill.scale?.value || 'N/A'} | Importance: ${skill.scale_importance?.value || 'N/A'}`);
      });
      console.log(`\n📊 Total skills: ${data.element.length}`);
    } else {
      console.log('⚠️  No skills found');
    }

    return data;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return null;
  }
}

/**
 * Test 4: Search for energy sector occupation
 */
async function testEnergySectorSearch() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: Search for "solar energy" occupations');
  console.log('='.repeat(60));

  try {
    const data = await onetRequest('/online/search?keyword=solar+energy');
    console.log('✅ Success! Energy sector occupations:');

    if (data.occupation && data.occupation.length > 0) {
      data.occupation.forEach((occ, i) => {
        console.log(`  ${i + 1}. ${occ.code} - ${occ.title}`);
      });
    } else {
      console.log('⚠️  No occupations found');
    }

    return data;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return null;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n🚀 Starting O*NET API Connection Tests\n');

  const results = {
    skillSearch: await testSkillSearch(),
    occupationDetails: await testOccupationDetails(),
    occupationSkills: await testOccupationSkills(),
    energySectorSearch: await testEnergySectorSearch()
  };

  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = Object.values(results).filter(r => r !== null).length;
  const total = Object.keys(results).length;

  console.log(`✅ Passed: ${passed}/${total} tests`);

  if (passed === total) {
    console.log('\n🎉 All tests passed! O*NET API is working correctly.');
    console.log('📝 Next step: Build the O*NET client (src/utils/onetClient.js)');
  } else {
    console.log('\n⚠️  Some tests failed. Check your API credentials.');
  }

  return results;
}

// Run tests
runTests().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
