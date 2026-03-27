import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ============================================================
// DATABASE CONNECTION
// ============================================================
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'pdf_processor';
let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  cachedClient = client;
  cachedDb = client.db(DB_NAME);
  return cachedDb;
}

// ============================================================
// IN-MEMORY JOB TRACKER (survives hot reload via global)
// ============================================================
if (!global.__pdfJobs) global.__pdfJobs = new Map();
const activeJobs = global.__pdfJobs;

// ============================================================
// PDF UTILITIES (using poppler-utils system tools)
// ============================================================

/**
 * Recursively find all .pdf files in a directory
 */
function findPdfsRecursive(dirPath) {
  let results = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(findPdfsRecursive(fullPath));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err.message);
  }
  return results;
}

/**
 * Get PDF page count using pdfinfo (poppler-utils)
 */
function getPdfPageCount(pdfPath) {
  try {
    const output = execSync(`pdfinfo "${pdfPath}" 2>/dev/null`, { encoding: 'utf-8' });
    const match = output.match(/Pages:\s+(\d+)/);
    return match ? parseInt(match[1]) : 0;
  } catch (err) {
    console.error(`Error getting page count for ${pdfPath}:`, err.message);
    return 0;
  }
}

/**
 * Convert a single PDF page to a PNG image buffer using pdftoppm
 * This is where actual image conversion happens
 */
function convertPageToImage(pdfPath, pageNum, outputDir) {
  try {
    const outputPrefix = path.join(outputDir, `page_convert`);
    execSync(
      `pdftoppm -png -f ${pageNum} -l ${pageNum} -r 150 -singlefile "${pdfPath}" "${outputPrefix}"`,
      { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const imagePath = `${outputPrefix}.png`;
    if (fs.existsSync(imagePath)) {
      const buffer = fs.readFileSync(imagePath);
      // Clean up temp image to save memory
      fs.unlinkSync(imagePath);
      return buffer;
    }
    return null;
  } catch (err) {
    console.error(`Error converting page ${pageNum} to image:`, err.message);
    return null;
  }
}

/**
 * Extract text from a specific PDF page using pdftotext
 */
function extractTextFromPage(pdfPath, pageNum) {
  try {
    const output = execSync(
      `pdftotext -f ${pageNum} -l ${pageNum} -layout "${pdfPath}" -`,
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim();
  } catch (err) {
    return '';
  }
}

// ============================================================
// EXTRACTION FUNCTION (MOCK)
// ============================================================
/**
 * extractDataFromImage - MOCK OCR/Vision API Response
 * 
 * THIS IS WHERE YOU PLUG IN YOUR ACTUAL OCR OR VISION API.
 * 
 * Integration options:
 * 
 * 1. OpenAI Vision API (GPT-4o):
 *    const response = await openai.chat.completions.create({
 *      model: 'gpt-4o',
 *      messages: [{
 *        role: 'user',
 *        content: [
 *          { type: 'text', text: 'Extract all structured data from this document page.' },
 *          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBuffer.toString('base64')}` } }
 *        ]
 *      }]
 *    });
 * 
 * 2. Google Cloud Vision API:
 *    const [result] = await visionClient.textDetection(imageBuffer);
 *    const text = result.fullTextAnnotation.text;
 * 
 * 3. Azure AI Vision:
 *    const result = await client.readInStream(imageBuffer);
 * 
 * 4. Tesseract.js (Local OCR - no API key needed):
 *    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
 * 
 * @param {Buffer|null} imageBuffer - PNG image buffer of the PDF page
 * @param {string} pageText - Text extracted from the page via pdftotext
 * @param {Object} metadata - Additional metadata (filename, page number, etc.)
 * @returns {Object} Structured extraction result
 */
async function extractDataFromImage(imageBuffer, pageText, metadata) {
  // Simulate processing delay (remove in production)
  await new Promise(resolve => setTimeout(resolve, 100));

  // Parse the page text into structured components
  const lines = (pageText || '').split('\n').filter(l => l.trim().length > 0);
  const headings = lines.filter(l => l.length < 80 && l.trim().length > 0).slice(0, 5);
  const paragraphs = (pageText || '').split('\n\n').filter(p => p.trim().length > 20);

  // Detect potential key-value pairs
  const keyValuePairs = {};
  for (const line of lines) {
    const kvMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (kvMatch && kvMatch[1].length < 40) {
      keyValuePairs[kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }

  return {
    raw_text: pageText || 'No text extracted from this page.',
    structured_data: {
      title: headings[0] || metadata?.fileName || 'Untitled',
      headings: headings,
      paragraphs: paragraphs,
      key_value_pairs: keyValuePairs,
      word_count: (pageText || '').split(/\s+/).filter(w => w.length > 0).length,
      line_count: lines.length,
    },
    confidence: parseFloat((0.90 + Math.random() * 0.10).toFixed(4)),
    extraction_method: 'mock_poppler_extraction',
    image_processed: imageBuffer !== null,
    image_size_bytes: imageBuffer ? imageBuffer.length : 0,
  };
}

// ============================================================
// JSONL FORMATTER (Hugging Face compatible)
// ============================================================
/**
 * Formats extracted data into Hugging Face JSONL training format.
 * Uses the conversational format (messages array) compatible with
 * OpenAI fine-tuning, Hugging Face TRL, and most LLM training frameworks.
 */
function formatToJsonl(record) {
  const { source, page, totalPages, extractedData } = record;
  const fileName = path.basename(source);

  const entry = {
    messages: [
      {
        role: 'system',
        content: 'You are a document analysis assistant. Given a page from a PDF document, extract and structure all relevant information including text, key-value pairs, headings, and data tables.'
      },
      {
        role: 'user',
        content: `Analyze page ${page} of ${totalPages} from the document "${fileName}". Extract all structured information.\n\nRaw text content:\n${extractedData.raw_text.substring(0, 2000)}`
      },
      {
        role: 'assistant',
        content: JSON.stringify(extractedData.structured_data)
      }
    ],
    metadata: {
      source_file: fileName,
      source_path: source,
      page_number: page,
      total_pages: totalPages,
      confidence: extractedData.confidence,
      extraction_method: extractedData.extraction_method,
      image_processed: extractedData.image_processed,
      word_count: extractedData.structured_data.word_count,
      timestamp: new Date().toISOString()
    }
  };

  return JSON.stringify(entry);
}

// ============================================================
// MAIN JOB PROCESSOR
// ============================================================
async function processJob(jobId, folderPath) {
  const db = await getDb();
  const jobsCol = db.collection('jobs');
  const tmpDir = `/tmp/pdf-processor/${jobId}`;
  const outputPath = path.join(tmpDir, 'output.jsonl');

  fs.mkdirSync(tmpDir, { recursive: true });

  // Clear any existing output file
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  try {
    // Step 1: Find all PDFs recursively
    const pdfFiles = findPdfsRecursive(folderPath);

    if (pdfFiles.length === 0) {
      const noFilesData = {
        status: 'completed',
        totalFiles: 0,
        processedFiles: 0,
        totalPages: 0,
        processedPages: 0,
        outputPath,
        logs: ['No PDF files found in the specified directory.'],
        completedAt: new Date()
      };
      activeJobs.set(jobId, noFilesData);
      await jobsCol.updateOne({ _id: jobId }, { $set: noFilesData });
      return;
    }

    // Step 2: Count total pages for progress tracking
    let totalPages = 0;
    const filePageCounts = [];
    for (const pdfPath of pdfFiles) {
      const pageCount = getPdfPageCount(pdfPath);
      filePageCounts.push({ path: pdfPath, pages: pageCount });
      totalPages += pageCount;
    }

    // Initialize job state
    const jobState = {
      status: 'processing',
      totalFiles: pdfFiles.length,
      processedFiles: 0,
      totalPages,
      processedPages: 0,
      currentFile: '',
      errors: [],
      outputPath,
      logs: [`Found ${pdfFiles.length} PDF file(s) with ${totalPages} total page(s)`],
    };
    activeJobs.set(jobId, jobState);
    await jobsCol.updateOne({ _id: jobId }, { $set: jobState });

    // Step 3: Process each PDF file sequentially
    let processedPages = 0;
    let processedFiles = 0;

    for (const { path: pdfPath, pages } of filePageCounts) {
      const fileName = path.basename(pdfPath);
      const job = activeJobs.get(jobId);

      try {
        job.currentFile = fileName;
        job.logs.push(`Processing: ${fileName} (${pages} page${pages !== 1 ? 's' : ''})`);

        for (let pageNum = 1; pageNum <= pages; pageNum++) {
          try {
            // Step 3a: Convert PDF page to image (PDF -> Image)
            const imageBuffer = convertPageToImage(pdfPath, pageNum, tmpDir);

            // Step 3b: Extract text from the page
            const pageText = extractTextFromPage(pdfPath, pageNum);

            // Step 3c: Run extraction logic (MOCK - plug in OCR/Vision API here)
            const extractedData = await extractDataFromImage(
              imageBuffer,
              pageText,
              { fileName, pageNum, totalPages: pages }
            );

            // Step 3d: Format as JSONL (Hugging Face compatible)
            const jsonlLine = formatToJsonl({
              source: pdfPath,
              page: pageNum,
              totalPages: pages,
              extractedData
            });

            // Step 3e: Stream to disk (append, don't hold in memory)
            fs.appendFileSync(outputPath, jsonlLine + '\n');

            processedPages++;
          } catch (pageError) {
            // Log error and continue with next page
            processedPages++;
            job.errors.push(`${fileName} page ${pageNum}: ${pageError.message}`);
          }

          // Update progress
          job.processedPages = processedPages;
          // Throttle MongoDB updates (every 5 pages or last page)
          if (processedPages % 5 === 0 || pageNum === pages) {
            await jobsCol.updateOne({ _id: jobId }, {
              $set: {
                processedPages,
                currentFile: fileName,
                processedFiles
              }
            });
          }
        }

        processedFiles++;
        job.processedFiles = processedFiles;
        job.logs.push(`Completed: ${fileName}`);

      } catch (fileError) {
        // Skip corrupted PDFs and continue
        processedFiles++;
        job.processedFiles = processedFiles;
        job.errors.push(`Skipped: ${fileName} - ${fileError.message}`);
        job.logs.push(`Skipped (error): ${fileName}`);
        console.error(`Error processing ${fileName}:`, fileError.message);
      }
    }

    // Step 4: Mark job as complete
    const outputStats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
    const finalState = {
      status: 'completed',
      processedFiles,
      processedPages,
      outputSizeBytes: outputStats ? outputStats.size : 0,
      completedAt: new Date()
    };

    const job = activeJobs.get(jobId);
    Object.assign(job, finalState);
    job.logs.push(`Job complete! ${processedPages} pages from ${processedFiles} files. Output: ${outputStats ? (outputStats.size / 1024).toFixed(1) + ' KB' : '0 KB'}`);

    await jobsCol.updateOne({ _id: jobId }, { $set: finalState });

  } catch (error) {
    const job = activeJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.errors.push(`Fatal error: ${error.message}`);
      job.logs.push(`Job failed: ${error.message}`);
    }
    await jobsCol.updateOne({ _id: jobId }, {
      $set: { status: 'failed', error: error.message, completedAt: new Date() }
    });
    console.error(`Job ${jobId} failed:`, error);
  }
}

// ============================================================
// API ROUTE HANDLER
// ============================================================
async function handler(request, context) {
  const resolvedParams = await context.params;
  const pathSegments = resolvedParams?.path || [];
  const method = request.method;

  const headers = {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (method === 'OPTIONS') {
    return new NextResponse(null, { status: 200, headers });
  }

  try {
    // ---- POST /api/jobs ----
    // Start a new PDF processing job
    if (method === 'POST' && pathSegments[0] === 'jobs' && pathSegments.length === 1) {
      const body = await request.json();
      const { folderPath } = body;

      if (!folderPath || typeof folderPath !== 'string') {
        return NextResponse.json(
          { error: 'folderPath is required and must be a string' },
          { status: 400, headers }
        );
      }

      const cleanPath = folderPath.trim();

      if (!fs.existsSync(cleanPath)) {
        return NextResponse.json(
          { error: `Folder path does not exist: ${cleanPath}` },
          { status: 400, headers }
        );
      }

      if (!fs.statSync(cleanPath).isDirectory()) {
        return NextResponse.json(
          { error: 'The specified path is not a directory' },
          { status: 400, headers }
        );
      }

      const jobId = uuidv4();
      const db = await getDb();

      const initialJobData = {
        _id: jobId,
        folderPath: cleanPath,
        status: 'initializing',
        totalFiles: 0,
        processedFiles: 0,
        totalPages: 0,
        processedPages: 0,
        currentFile: '',
        errors: [],
        outputPath: '',
        logs: ['Job created, scanning for PDF files...'],
        createdAt: new Date()
      };

      await db.collection('jobs').insertOne(initialJobData);
      activeJobs.set(jobId, { ...initialJobData });

      // Start processing in background (non-blocking)
      processJob(jobId, cleanPath).catch(err => {
        console.error(`Job ${jobId} background error:`, err);
      });

      return NextResponse.json(
        { jobId, status: 'initializing', message: 'Processing started' },
        { status: 200, headers }
      );
    }

    // ---- GET /api/jobs/progress?jobId=xxx ----
    // Poll for job progress
    if (method === 'GET' && pathSegments[0] === 'jobs' && pathSegments[1] === 'progress') {
      const url = new URL(request.url);
      const jobId = url.searchParams.get('jobId');

      if (!jobId) {
        return NextResponse.json(
          { error: 'jobId query parameter is required' },
          { status: 400, headers }
        );
      }

      // Check in-memory first (fastest)
      let jobData = activeJobs.get(jobId);

      // Fallback to MongoDB
      if (!jobData) {
        const db = await getDb();
        jobData = await db.collection('jobs').findOne({ _id: jobId });
      }

      if (!jobData) {
        return NextResponse.json(
          { error: 'Job not found' },
          { status: 404, headers }
        );
      }

      const progress = jobData.totalPages > 0
        ? Math.round((jobData.processedPages / jobData.totalPages) * 100)
        : 0;

      return NextResponse.json({
        jobId,
        status: jobData.status,
        totalFiles: jobData.totalFiles || 0,
        processedFiles: jobData.processedFiles || 0,
        totalPages: jobData.totalPages || 0,
        processedPages: jobData.processedPages || 0,
        currentFile: jobData.currentFile || '',
        errors: (jobData.errors || []).slice(-10),
        logs: (jobData.logs || []).slice(-30),
        progress,
        outputSizeBytes: jobData.outputSizeBytes || 0,
      }, { status: 200, headers });
    }

    // ---- GET /api/jobs/download?jobId=xxx ----
    // Download the generated JSONL file
    if (method === 'GET' && pathSegments[0] === 'jobs' && pathSegments[1] === 'download') {
      const url = new URL(request.url);
      const jobId = url.searchParams.get('jobId');

      if (!jobId) {
        return NextResponse.json(
          { error: 'jobId query parameter is required' },
          { status: 400, headers }
        );
      }

      const outputPath = `/tmp/pdf-processor/${jobId}/output.jsonl`;

      if (!fs.existsSync(outputPath)) {
        return NextResponse.json(
          { error: 'Output file not found. The job may still be processing or no data was generated.' },
          { status: 404, headers }
        );
      }

      const fileBuffer = fs.readFileSync(outputPath);
      const stats = fs.statSync(outputPath);

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="training_data_${jobId.slice(0, 8)}.jsonl"`,
          'Content-Length': stats.size.toString(),
        }
      });
    }

    // ---- POST /api/test/generate ----
    // Generate sample test PDFs for testing the pipeline
    // Uses standalone script to avoid pdfkit font resolution issues in Next.js bundling
    if (method === 'POST' && pathSegments[0] === 'test' && pathSegments[1] === 'generate') {
      try {
        const output = execSync('node /app/scripts/generate-test-pdfs.js', {
          encoding: 'utf-8',
          timeout: 30000,
          cwd: '/app'
        });
        const result = JSON.parse(output.trim());

        if (!result.success) {
          throw new Error(result.error || 'Failed to generate test PDFs');
        }

        return NextResponse.json(result, { status: 200, headers });
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to generate test PDFs: ${err.message}` },
          { status: 500, headers }
        );
      }
    }

    // ---- GET /api/jobs/list ----
    // List recent jobs
    if (method === 'GET' && pathSegments[0] === 'jobs' && pathSegments[1] === 'list') {
      const db = await getDb();
      const jobs = await db.collection('jobs')
        .find({})
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();

      return NextResponse.json({
        jobs: jobs.map(j => ({
          jobId: j._id,
          status: j.status,
          folderPath: j.folderPath,
          totalFiles: j.totalFiles,
          processedFiles: j.processedFiles,
          totalPages: j.totalPages,
          processedPages: j.processedPages,
          createdAt: j.createdAt,
          completedAt: j.completedAt
        }))
      }, { status: 200, headers });
    }

    // ---- GET /api/health ----
    if (method === 'GET' && pathSegments[0] === 'health') {
      const db = await getDb();
      return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: { database: 'connected', poppler: 'available' }
      }, { status: 200, headers });
    }

    // ---- 404 ----
    return NextResponse.json(
      { error: `Not found: ${method} /api/${pathSegments.join('/')}` },
      { status: 404, headers }
    );

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers }
    );
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as OPTIONS };
