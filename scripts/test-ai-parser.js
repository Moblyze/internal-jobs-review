/**
 * Test script for AI-powered job description parser
 *
 * Tests the restructureJobDescription function with real job data
 * from the Baker Hughes Supply Chain Localization Leader position.
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import { restructureJobDescription, isAiParsingAvailable } from '../src/utils/aiDescriptionParser.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sample job description from Baker Hughes
const SAMPLE_DESCRIPTION = `Do you enjoy working on Supply Chain projects?

Would you like the opportunity to work for oilfield services company?

Join our team

Our Oilfield Services business provides intelligent, connected technologies to monitor and control our energy extraction assets. Our team arranging technical expertise to meet our client expectation. We provide customers with the peace of mind needed to reliably and efficiently improve their operations.

Partner with the best

As the Supply Chain Localization Leader you will be responsible for leading and executing an integrated Supply Chain Localization strategy under UAE Unified ICV Program v4.0, targeting Goods Manufactured and Third-Party Spend to shift sourcing from import-heavy to locally optimized. You will drive measurable ICV uplift, ensuring compliance with MOIAT and ADNOC frameworks, and spearheading facility optimization projects across UAE to enhance operational efficiency and local value creation.

As a Supply Chain Localization Leader, you will be responsible for:
Developing and executing Supply Chain Localization Strategy for Baker Hughes business in the UAE. Targeting shift to UAE Based ICV-Certified Suppliers. Specific categories focus is needed on are Goods Manufactured as well as Third Party Spend.
Performing analysis of current supply chain Practices, conducting existing spend diagnostics, mapping high spend categories to UAE-Made alternatives.
Revamping Supply Chain for Local Sourcing, Partner with Local suppliers for active participation in Local Supplier Development programs.
Engaging with Suppliers to support their ICV Certifications and Scores, Conducting supplier training workshops in Conjunction with the ICV Leader.
Collaborating with cross-functional teams (Business Segments, GeoZones, Supply Chain) to drive UAE-based supply chain localization in alignment with the established localization strategy
Ensuring compliance with MoIAT and ADNOC ICV frameworks; Supporting with Internal / External ICV Audits specific to Third Party Spend and Goods Manufactured categories.
Identifying and leading facility cost optimization projects throughout the UAE Baker Hughes business.
To be successful in this role you will have:
Bachelors in supply chain, Engineering, Procurement or Business.
Minimum 5 Years with Supply Chain function, preferably within the Oil and Gas industry.
Thorough understanding of the MoIAT and ADNOC In Country Value frameworks (is preferred).
Proven Supply Chain Localization and/or Supplier Development experience.
Strong Analytical and Data Driven Decision making, ability to work within a matrix organization while leading with influence, executive communication Skills.

Working with Us

Our people are at the heart of what we do at Baker Hughes. We know we are better when all of our people are developed, engaged and able to bring their whole authentic selves to work. We invest in the health and well-being of our workforce, train, reward talent, and develop leaders at all levels to bring out the best in each other.



Working for you

Our inventions have revolutionized energy for over a century. But to keep going forward tomorrow, we know we have to push the boundaries today. We prioritize rewarding those who embrace change with a package that reflects how much we value their input. Join us, and you can expect:

Contemporary work-life balance policies and wellbeing activities
Comprehensive private medical care options
Safety net of life insurance and disability programs
Tailored financial programs
Additional elected or voluntary benefits

#LI_Onsite

The Baker Hughes internal title for this role is: Project Management Advisor - Functional Mgmt`;

async function main() {
  console.log('='.repeat(80));
  console.log('AI Job Description Parser - Test Script');
  console.log('='.repeat(80));
  console.log();

  // Check if AI parsing is available
  if (!isAiParsingAvailable()) {
    console.error('❌ Error: Anthropic API key not configured');
    console.error('Please set ANTHROPIC_API_KEY in your .env file');
    console.error('Get your API key from: https://console.anthropic.com/');
    process.exit(1);
  }

  console.log('✓ Anthropic API key configured');
  console.log();

  console.log('Testing with Baker Hughes Supply Chain Localization Leader job...');
  console.log();

  // Show original description
  console.log('Original Description Length:', SAMPLE_DESCRIPTION.length, 'characters');
  console.log('-'.repeat(80));
  console.log(SAMPLE_DESCRIPTION.substring(0, 200) + '...');
  console.log('-'.repeat(80));
  console.log();

  try {
    console.log('⏳ Calling Claude API to restructure description...');
    const startTime = Date.now();

    const structured = await restructureJobDescription(SAMPLE_DESCRIPTION);

    const endTime = Date.now();
    console.log(`✓ API call completed in ${endTime - startTime}ms`);
    console.log();

    // Check for errors
    if (structured.error) {
      console.error('❌ Error during restructuring:', structured.error);
      console.log();
      console.log('Fallback structure:');
    } else {
      console.log('✓ Successfully restructured description');
    }

    console.log();
    console.log('='.repeat(80));
    console.log('STRUCTURED OUTPUT');
    console.log('='.repeat(80));
    console.log();

    // Display structured sections
    console.log(`Found ${structured.sections.length} sections:`);
    console.log();

    structured.sections.forEach((section, index) => {
      console.log(`${index + 1}. ${section.title} (${section.type})`);
      console.log('-'.repeat(80));

      if (section.type === 'paragraph') {
        console.log(section.content);
      } else if (section.type === 'list') {
        section.content.forEach((item, i) => {
          console.log(`   ${i + 1}. ${item}`);
        });
      }

      console.log();
    });

    // Save output to file
    const outputPath = path.join(__dirname, 'test-ai-parser-output.json');
    fs.writeFileSync(outputPath, JSON.stringify(structured, null, 2), 'utf-8');
    console.log('='.repeat(80));
    console.log(`✓ Output saved to: ${outputPath}`);
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
