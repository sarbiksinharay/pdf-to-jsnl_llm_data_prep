#!/usr/bin/env node
/**
 * Standalone script to generate test PDF files.
 * Run outside of Next.js bundling to avoid pdfkit font resolution issues.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const testDir = process.argv[2] || '/tmp/test-pdfs';

// Clean and recreate test directory
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true });
}
fs.mkdirSync(testDir, { recursive: true });
fs.mkdirSync(path.join(testDir, 'archived'), { recursive: true });

const sampleData = [
  {
    name: 'invoice_001.pdf',
    pages: [
      {
        title: 'INVOICE #INV-2025-001',
        body: 'From: Acme Corporation\n123 Business Ave, Suite 400\nSan Francisco, CA 94102\n\nTo: Client Industries Inc.\n456 Commerce St\nNew York, NY 10001\n\nDate: June 15, 2025\nDue Date: July 15, 2025\n\nDescription                    Qty    Unit Price    Total\n---------------------------------------------------------\nSoftware License (Annual)       1     $12,000.00    $12,000.00\nImplementation Services         40    $150.00       $6,000.00\nTraining Sessions               5     $500.00       $2,500.00\nSupport Package (Premium)       1     $3,600.00     $3,600.00\n\nSubtotal: $24,100.00\nTax (8.5%): $2,048.50\nTotal: $26,148.50'
      },
      {
        title: 'Payment Terms & Conditions',
        body: 'Payment Terms:\n- Net 30 days from invoice date\n- Late fee: 1.5% per month on overdue balances\n- Early payment discount: 2% if paid within 10 days\n\nPayment Methods:\n- Wire Transfer: First National Bank, Account #****4521\n- ACH: Routing #021000021\n- Credit Card: Via payment portal at pay.acmecorp.com\n\nNotes:\nThis invoice is for the Q3 2025 service period. All software licenses include\nsecurity updates and bug fixes. Support package includes 24/7 phone and email\nsupport with 4-hour response time guarantee.'
      }
    ]
  },
  {
    name: 'quarterly_report_q2_2025.pdf',
    pages: [
      {
        title: 'Q2 2025 Performance Report',
        body: 'Executive Summary\n\nQuarter: Q2 2025 (April - June)\nPrepared by: Analytics Team\nDate: July 1, 2025\n\nKey Metrics:\n- Total Revenue: $2,450,000\n- Revenue Growth: +15.3% YoY\n- Monthly Active Users: 52,340\n- Customer Retention Rate: 94.2%\n- Net Promoter Score: 72\n- Average Response Time: 1.2 seconds\n\nHighlights:\n1. Launched AI-powered document assistant feature\n2. Expanded to 3 new international markets\n3. Achieved SOC 2 Type II compliance\n4. Reduced infrastructure costs by 22%'
      },
      {
        title: 'Financial Breakdown',
        body: 'Revenue by Segment:\n\nEnterprise: $1,200,000 (49%)\nSMB: $750,000 (31%)\nIndividual: $500,000 (20%)\n\nExpenses:\nEngineering: $800,000\nSales & Marketing: $400,000\nOperations: $200,000\nG&A: $150,000\nTotal Expenses: $1,550,000\n\nNet Income: $900,000\nProfit Margin: 36.7%\n\nCash Position: $5.2M\nBurn Rate: -$0 (profitable)\nRunway: Infinite'
      },
      {
        title: 'Customer Analysis',
        body: 'Top Customer Segments:\n\nFinancial Services: 28% of revenue\nHealthcare: 22% of revenue\nTechnology: 18% of revenue\nRetail: 15% of revenue\nOther: 17% of revenue\n\nChurn Analysis:\n- Monthly churn rate: 1.8%\n- Primary churn reasons: Budget cuts (40%), Competitor switch (25%), Feature gaps (20%), Other (15%)\n- Recovery rate from at-risk accounts: 65%\n\nExpansion Revenue: $450,000 (18.4% of total)\nNet Revenue Retention: 118%'
      },
      {
        title: 'Q3 2025 Roadmap',
        body: 'Strategic Priorities:\n\n1. Mobile Application Launch\n   - iOS and Android native apps\n   - Target: August 2025\n   - Budget: $300,000\n\n2. Enterprise Tier Enhancement\n   - SSO integration\n   - Advanced audit logs\n   - Custom SLAs\n   - Target: September 2025\n\n3. API Marketplace\n   - Third-party integrations\n   - Developer portal\n   - Target: October 2025\n\n4. International Expansion\n   - LATAM market entry\n   - Localization for 5 languages\n   - Target: Q4 2025'
      }
    ]
  },
  {
    name: 'service_agreement_2025.pdf',
    pages: [
      {
        title: 'MASTER SERVICE AGREEMENT',
        body: 'This Master Service Agreement ("Agreement") is entered into as of June 1, 2025\n("Effective Date") by and between:\n\nProvider: TechSolutions Inc.\nAddress: 789 Innovation Drive, Austin, TX 78701\n\nClient: GlobalRetail Corp.\nAddress: 321 Market Street, Chicago, IL 60601\n\n1. SCOPE OF SERVICES\nProvider shall deliver software development, consulting, and managed IT services\nas detailed in the attached Statement of Work (SOW).\n\n2. TERM\nThis Agreement shall commence on the Effective Date and continue for a period\nof twelve (12) months, unless terminated earlier per Section 8.\n\n3. COMPENSATION\nTotal Contract Value: $500,000\nPayment Schedule: Monthly installments of $41,666.67\nPayment Terms: Net 30 days from invoice date'
      }
    ]
  },
  {
    name: 'archived/meeting_notes.pdf',
    pages: [
      {
        title: 'Board Meeting Notes - May 2025',
        body: 'Attendees: CEO, CTO, CFO, VP Engineering, VP Sales\nDate: May 28, 2025\nLocation: Conference Room A\n\nAgenda Items:\n\n1. Q2 Performance Review\n   - Revenue on track to exceed forecast by 8%\n   - Customer acquisition cost decreased 12%\n   - Action: Continue current growth strategy\n\n2. Product Roadmap Update\n   - AI features ahead of schedule\n   - Mobile app beta testing begins June 15\n   - Action: Allocate additional QA resources\n\n3. Hiring Plan\n   - 15 new engineering positions approved\n   - 5 sales positions for LATAM expansion\n   - Action: HR to begin recruiting immediately\n\n4. Budget Allocation\n   - R&D budget increased by $200K for Q3\n   - Marketing budget maintained at current levels\n   - Action: Finance to update projections'
      }
    ]
  }
];

let completedCount = 0;
const totalFiles = sampleData.length;
const totalPages = sampleData.reduce((sum, s) => sum + s.pages.length, 0);

function generatePdf(sample) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(testDir, sample.name);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(outputPath);

    doc.pipe(writeStream);

    for (let i = 0; i < sample.pages.length; i++) {
      if (i > 0) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(18).text(sample.pages[i].title, { align: 'center' });
      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(11).text(sample.pages[i].body, { align: 'left', lineGap: 3 });
    }

    doc.end();

    writeStream.on('finish', () => {
      completedCount++;
      resolve(outputPath);
    });
    writeStream.on('error', reject);
  });
}

async function main() {
  const files = [];
  for (const sample of sampleData) {
    const filePath = await generatePdf(sample);
    files.push(filePath);
  }

  const result = {
    success: true,
    message: `Generated ${files.length} test PDF files`,
    folderPath: testDir,
    files: files,
    totalPages: totalPages
  };

  // Output JSON to stdout for the API to read
  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
