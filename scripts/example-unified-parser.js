/**
 * Example: Using the Unified Description Parser
 *
 * Demonstrates different parsing strategies and use cases
 */

import {
  parseJobDescription,
  ParseStrategy,
  canUseAiParsing,
  getRecommendedStrategy,
  toPlainText,
  toHtml,
} from '../src/utils/descriptionParser.js';

// Sample well-formatted description
const WELL_FORMATTED = `ESSENTIAL RESPONSIBILITIES:
• Ensure compliance with manage the Job Cycle (MtJC) process
• Work with the assigned Service Delivery Coordinator/Salesperson
• Perform offset job analysis and product/service specific engineering

QUALIFICATIONS/REQUIREMENTS:
• Bachelor's degree in engineering
• Excellent leadership, strong interpersonal skills
• Ability to be on call outside of normal business hours

DESIRED CHARACTERISTICS:
• Significant operational experience
• Comfortable presenting in front of an audience`;

// Sample poorly-formatted description (blob)
const POORLY_FORMATTED = `Do you enjoy working on Supply Chain projects?

Would you like the opportunity to work for oilfield services company?

Join our team

Our Oilfield Services business provides intelligent, connected technologies to monitor and control our energy extraction assets. As the Supply Chain Localization Leader you will be responsible for leading and executing an integrated Supply Chain Localization strategy. You will develop and execute Supply Chain Localization Strategy for Baker Hughes business in the UAE. Targeting shift to UAE Based ICV-Certified Suppliers. You will perform analysis of current supply chain Practices, conducting existing spend diagnostics. You will revamp Supply Chain for Local Sourcing and partner with Local suppliers. To be successful you will need a Bachelors in supply chain, Engineering, Procurement or Business. Minimum 5 Years with Supply Chain function, preferably within the Oil and Gas industry is required. Strong Analytical and Data Driven Decision making skills are essential.`;

async function demonstrateAutoStrategy() {
  console.log('='.repeat(80));
  console.log('1. AUTO STRATEGY (Recommended)');
  console.log('='.repeat(80));
  console.log();

  // Well-formatted description
  console.log('Testing with well-formatted description...');
  const parsed1 = await parseJobDescription(WELL_FORMATTED, {
    strategy: ParseStrategy.AUTO,
  });
  console.log(`Method used: ${parsed1.metadata.method}`);
  console.log(`Sections found: ${parsed1.sections.length}`);
  console.log();

  // Poorly-formatted description
  console.log('Testing with poorly-formatted description...');
  const parsed2 = await parseJobDescription(POORLY_FORMATTED, {
    strategy: ParseStrategy.AUTO,
  });
  console.log(`Method used: ${parsed2.metadata.method}`);
  console.log(`Sections found: ${parsed2.sections.length}`);
  if (parsed2.metadata.error) {
    console.log(`Error: ${parsed2.metadata.error}`);
  }
  console.log();
}

async function demonstrateRecommendedStrategy() {
  console.log('='.repeat(80));
  console.log('2. GET RECOMMENDED STRATEGY');
  console.log('='.repeat(80));
  console.log();

  const strategy1 = getRecommendedStrategy(WELL_FORMATTED);
  console.log('Well-formatted description:');
  console.log(`  Recommended: ${strategy1}`);
  console.log();

  const strategy2 = getRecommendedStrategy(POORLY_FORMATTED);
  console.log('Poorly-formatted description:');
  console.log(`  Recommended: ${strategy2}`);
  console.log();
}

async function demonstrateOutputFormats() {
  console.log('='.repeat(80));
  console.log('3. OUTPUT FORMATS');
  console.log('='.repeat(80));
  console.log();

  const parsed = await parseJobDescription(WELL_FORMATTED, {
    strategy: ParseStrategy.TRADITIONAL_ONLY,
  });

  // Plain text
  console.log('Plain Text Output:');
  console.log('-'.repeat(80));
  const plainText = toPlainText(parsed);
  console.log(plainText.substring(0, 200) + '...');
  console.log();

  // HTML
  console.log('HTML Output:');
  console.log('-'.repeat(80));
  const html = toHtml(parsed, {
    headerTag: 'h3',
    className: 'job',
  });
  console.log(html.substring(0, 300) + '...');
  console.log();
}

async function demonstrateAiOnly() {
  console.log('='.repeat(80));
  console.log('4. AI-ONLY STRATEGY');
  console.log('='.repeat(80));
  console.log();

  if (!canUseAiParsing()) {
    console.log('❌ AI parsing not available (API key not configured)');
    console.log();
    return;
  }

  console.log('✓ AI parsing available');
  console.log();

  console.log('Testing with poorly-formatted description...');
  const startTime = Date.now();

  const parsed = await parseJobDescription(POORLY_FORMATTED, {
    strategy: ParseStrategy.AI_ONLY,
  });

  const duration = Date.now() - startTime;
  console.log(`Completed in ${duration}ms`);
  console.log();

  if (parsed.metadata.error) {
    console.log(`❌ Error: ${parsed.metadata.error}`);
  } else {
    console.log(`✓ Successfully parsed with AI`);
    console.log(`Sections found: ${parsed.sections.length}`);
    console.log();

    // Display sections
    parsed.sections.forEach((section, i) => {
      console.log(`${i + 1}. ${section.title || '(No Title)'} [${section.type}]`);
      if (section.type === 'list') {
        console.log(`   ${section.content.length} items`);
      } else if (section.type === 'paragraph') {
        console.log(`   ${section.content.substring(0, 60)}...`);
      }
    });
  }
  console.log();
}

async function demonstrateHybridApproach() {
  console.log('='.repeat(80));
  console.log('5. HYBRID APPROACH (Real-World Example)');
  console.log('='.repeat(80));
  console.log();

  console.log('Processing batch of job descriptions...');
  console.log();

  const jobs = [
    {
      id: 1,
      title: 'Well-formatted job',
      description: WELL_FORMATTED,
    },
    {
      id: 2,
      title: 'Poorly-formatted job',
      description: POORLY_FORMATTED,
    },
  ];

  for (const job of jobs) {
    console.log(`Job #${job.id}: ${job.title}`);

    // Get recommended strategy
    const strategy = getRecommendedStrategy(job.description);
    console.log(`  Strategy: ${strategy}`);

    // Parse with recommended strategy
    const parsed = await parseJobDescription(job.description, { strategy });
    console.log(`  Method: ${parsed.metadata.method}`);
    console.log(`  Sections: ${parsed.sections.length}`);

    if (parsed.metadata.error) {
      console.log(`  Error: ${parsed.metadata.error}`);
    }

    console.log();
  }
}

async function main() {
  console.log();
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(20) + 'UNIFIED DESCRIPTION PARSER EXAMPLES' + ' '.repeat(23) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log();

  try {
    // Run demonstrations
    await demonstrateAutoStrategy();
    await demonstrateRecommendedStrategy();
    await demonstrateOutputFormats();
    await demonstrateAiOnly();
    await demonstrateHybridApproach();

    console.log('='.repeat(80));
    console.log('✓ All examples completed successfully');
    console.log('='.repeat(80));
    console.log();

    // Usage summary
    console.log('USAGE SUMMARY:');
    console.log();
    console.log('Quick Start:');
    console.log('  const parsed = await parseJobDescription(description);');
    console.log();
    console.log('Force AI:');
    console.log('  const parsed = await parseJobDescription(description, {');
    console.log('    strategy: ParseStrategy.AI_ONLY');
    console.log('  });');
    console.log();
    console.log('Traditional Only:');
    console.log('  const parsed = await parseJobDescription(description, {');
    console.log('    strategy: ParseStrategy.TRADITIONAL_ONLY');
    console.log('  });');
    console.log();
    console.log('Convert to HTML:');
    console.log('  const html = toHtml(parsed);');
    console.log();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
