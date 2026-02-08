/**
 * Test O*NET Client
 * Verifies all functions in the onetClient module
 */

import * as onetClient from '../src/utils/onetClient.js';

console.log('🧪 Testing O*NET Client\n');
console.log('Configuration:', onetClient.config);
console.log('');

/**
 * Test 1: Search function
 */
async function testSearch() {
  console.log('='.repeat(60));
  console.log('TEST 1: Search for occupations');
  console.log('='.repeat(60));

  try {
    const results = await onetClient.search('electrician');
    console.log('✅ Search results:');
    console.log(`   Found ${results.occupation?.length || 0} occupations`);

    if (results.occupation && results.occupation.length > 0) {
      results.occupation.slice(0, 3).forEach((occ, i) => {
        console.log(`   ${i + 1}. ${occ.code} - ${occ.title}`);
      });
    }

    return true;
  } catch (error) {
    console.error('❌ Search test failed:', error.message);
    return false;
  }
}

/**
 * Test 2: Get occupation details
 */
async function testGetOccupation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Get occupation details');
  console.log('='.repeat(60));

  try {
    const occupation = await onetClient.getOccupation('47-2111.00'); // Electricians
    console.log('✅ Occupation details:');
    console.log(`   Code: ${occupation.code}`);
    console.log(`   Title: ${occupation.title}`);
    console.log(`   Description: ${occupation.description?.substring(0, 100)}...`);

    return true;
  } catch (error) {
    console.error('❌ Get occupation test failed:', error.message);
    return false;
  }
}

/**
 * Test 3: Get occupation skills
 */
async function testGetOccupationSkills() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Get occupation skills');
  console.log('='.repeat(60));

  try {
    const skills = await onetClient.getOccupationSkills('47-2111.00');
    console.log('✅ Skills found:');
    console.log(`   Total: ${skills.length}`);

    skills.slice(0, 5).forEach((skill, i) => {
      console.log(`   ${i + 1}. ${skill.name} (${skill.id})`);
    });

    return true;
  } catch (error) {
    console.error('❌ Get skills test failed:', error.message);
    return false;
  }
}

/**
 * Test 4: Find occupation by job title
 */
async function testFindOccupation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: Find occupation by job title');
  console.log('='.repeat(60));

  try {
    const match = await onetClient.findOccupation('Solar Panel Installer');
    console.log('✅ Best match:');
    console.log(`   Code: ${match.code}`);
    console.log(`   Title: ${match.title}`);
    console.log(`   Confidence: ${match.confidence}`);

    if (match.alternates && match.alternates.length > 0) {
      console.log('   Alternatives:');
      match.alternates.slice(0, 2).forEach((alt, i) => {
        console.log(`      ${i + 1}. ${alt.title}`);
      });
    }

    return true;
  } catch (error) {
    console.error('❌ Find occupation test failed:', error.message);
    return false;
  }
}

/**
 * Test 5: Search for skills
 */
async function testSearchSkills() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: Search for skills');
  console.log('='.repeat(60));

  try {
    const skills = await onetClient.searchSkills('welding');
    console.log('✅ Skills found:');
    console.log(`   Total unique skills: ${skills.length}`);

    skills.slice(0, 5).forEach((skill, i) => {
      console.log(`   ${i + 1}. ${skill.name} (${skill.id})`);
    });

    return true;
  } catch (error) {
    console.error('❌ Search skills test failed:', error.message);
    return false;
  }
}

/**
 * Test 6: Get recommended skills for a job
 */
async function testGetRecommendedSkills() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 6: Get recommended skills for job title');
  console.log('='.repeat(60));

  try {
    const recommended = await onetClient.getRecommendedSkills('HVAC Technician');
    console.log('✅ Recommended skills:');
    console.log(`   Matched: ${recommended.matched}`);

    if (recommended.matched) {
      console.log(`   Occupation: ${recommended.occupation.title}`);
      console.log(`   Confidence: ${recommended.occupation.confidence}`);
      console.log(`   Skills (${recommended.skills.length} total):`);

      recommended.skills.slice(0, 5).forEach((skill, i) => {
        console.log(`      ${i + 1}. ${skill.name}`);
      });
    }

    return true;
  } catch (error) {
    console.error('❌ Get recommended skills test failed:', error.message);
    return false;
  }
}

/**
 * Test 7: Batch search skills
 */
async function testBatchSearchSkills() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 7: Batch search multiple skills');
  console.log('='.repeat(60));

  try {
    const skillNames = ['communication', 'problem solving', 'leadership'];
    const results = await onetClient.batchSearchSkills(skillNames);

    console.log('✅ Batch search results:');
    for (const [skillName, matches] of results) {
      console.log(`   "${skillName}": ${matches.length} matches`);
      if (matches.length > 0) {
        console.log(`      → ${matches[0].name}`);
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Batch search test failed:', error.message);
    return false;
  }
}

/**
 * Test 8: Enrich job with O*NET data
 */
async function testEnrichJob() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 8: Enrich job with O*NET data');
  console.log('='.repeat(60));

  try {
    const job = {
      title: 'Electrician',
      company: 'Test Company',
      location: 'Houston, TX'
    };

    const enrichedJob = await onetClient.enrichJobWithONet(job);

    console.log('✅ Job enrichment:');
    console.log(`   Original title: ${job.title}`);
    console.log(`   O*NET matched: ${enrichedJob.onet?.matched}`);

    if (enrichedJob.onet?.matched) {
      console.log(`   O*NET occupation: ${enrichedJob.onet.occupation.title}`);
      console.log(`   Recommended skills: ${enrichedJob.onet.recommendedSkills.length}`);
    }

    return true;
  } catch (error) {
    console.error('❌ Enrich job test failed:', error.message);
    return false;
  }
}

/**
 * Test 9: Cache functionality
 */
async function testCache() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 9: Cache functionality');
  console.log('='.repeat(60));

  try {
    // First request (should hit API)
    const start1 = Date.now();
    await onetClient.search('welder');
    const time1 = Date.now() - start1;

    // Second request (should hit cache)
    const start2 = Date.now();
    await onetClient.search('welder');
    const time2 = Date.now() - start2;

    console.log('✅ Cache test:');
    console.log(`   First request: ${time1}ms (API call)`);
    console.log(`   Second request: ${time2}ms (cached)`);
    console.log(`   Speed improvement: ${Math.round((time1 / time2) * 100) / 100}x faster`);

    const stats = onetClient.getCacheStats();
    console.log(`   Cache entries: ${stats.entries}`);
    console.log(`   Cache size: ${Math.round(stats.sizeBytes / 1024)}KB`);

    return true;
  } catch (error) {
    console.error('❌ Cache test failed:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  const tests = [
    { name: 'Search', fn: testSearch },
    { name: 'Get Occupation', fn: testGetOccupation },
    { name: 'Get Occupation Skills', fn: testGetOccupationSkills },
    { name: 'Find Occupation', fn: testFindOccupation },
    { name: 'Search Skills', fn: testSearchSkills },
    { name: 'Get Recommended Skills', fn: testGetRecommendedSkills },
    { name: 'Batch Search Skills', fn: testBatchSearchSkills },
    { name: 'Enrich Job', fn: testEnrichJob },
    { name: 'Cache', fn: testCache }
  ];

  const results = [];

  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
    } catch (error) {
      console.error(`\n💥 Test "${test.name}" threw an error:`, error);
      results.push({ name: test.name, passed: false });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  results.forEach(result => {
    console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
  });

  console.log(`\n${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All tests passed! O*NET client is ready to use.');
    console.log('📝 Next: Integrate with skillValidator.js');
  } else {
    console.log('\n⚠️  Some tests failed. Review errors above.');
  }

  return passed === total;
}

// Run tests
runAllTests().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
