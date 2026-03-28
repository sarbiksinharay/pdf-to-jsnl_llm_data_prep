import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

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
// PDFJS-DIST INITIALIZATION (Cross-platform, pure JavaScript)
// ============================================================
let _pdfjsLib = null;

async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  // Use legacy build for maximum Node.js compatibility
  _pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjsLib;
}

// ============================================================
// OPTIONAL: Check if poppler-utils is available (Linux/Mac)
// If available, we use it for PDF→Image conversion
// If not (Windows), we skip image conversion gracefully
// ============================================================
let _popplerAvailable = null;

function isPopplerAvailable() {
  if (_popplerAvailable !== null) return _popplerAvailable;
  try {
    execSync('pdftoppm -v', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    _popplerAvailable = true;
  } catch {
    _popplerAvailable = false;
  }
  return _popplerAvailable;
}

// ============================================================
// PDF UTILITIES
// ============================================================

/**
 * Recursively find all .pdf files in a directory.
 * Works on Windows, Linux, macOS.
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
 * Convert a single PDF page to a PNG image buffer using poppler (if available).
 * Uses execFileSync (no shell) to handle paths with spaces/special chars.
 * Returns null if poppler is not installed.
 */
function convertPageToImageWithPoppler(pdfPath, pageNum, outputDir) {
  if (!isPopplerAvailable()) return null;
  try {
    const outputPrefix = path.join(outputDir, 'page_convert');
    // Use execFileSync to avoid shell escaping issues with paths
    execFileSync('pdftoppm', [
      '-png', '-f', String(pageNum), '-l', String(pageNum),
      '-r', '150', '-singlefile',
      pdfPath, outputPrefix
    ], { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });

    const imagePath = `${outputPrefix}.png`;
    if (fs.existsSync(imagePath)) {
      const buffer = fs.readFileSync(imagePath);
      fs.unlinkSync(imagePath); // Clean up temp image
      return buffer;
    }
    return null;
  } catch (err) {
    return null;
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
 * @param {Buffer|null} imageBuffer - PNG image buffer of the PDF page (null if poppler unavailable)
 * @param {string} pageText - Text extracted from the page via pdfjs-dist
 * @param {Object} metadata - Additional metadata (filename, page number, etc.)
 * @returns {Object} Structured extraction result
 */
async function extractDataFromImage(imageBuffer, pageText, metadata) {
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
    extraction_method: imageBuffer ? 'poppler_image_extraction' : 'pdfjs_text_extraction',
    image_processed: imageBuffer !== null,
    image_size_bytes: imageBuffer ? imageBuffer.length : 0,
  };
}

// ============================================================
// JSONL FORMATTER (Hugging Face compatible)
// ============================================================
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
// PROCESS A SINGLE PDF FILE (using pdfjs-dist)
// ============================================================
async function processSinglePdf(pdfPath, outputPath, tmpDir, jobState) {
  const pdfjs = await getPdfJs();
  const fileName = path.basename(pdfPath);

  let doc = null;
  try {
    // Read the file into memory
    const fileBuffer = fs.readFileSync(pdfPath);
    const data = new Uint8Array(fileBuffer);

    // Load with pdfjs-dist (pure JavaScript, cross-platform)
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      // Provide standard font data path for better font rendering
      standardFontDataUrl: path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/',
    });

    doc = await loadingTask.promise;
    const numPages = doc.numPages;

    if (numPages === 0) {
      jobState.logs.push(`Skipped: ${fileName} (0 pages)`);
      doc.destroy();
      return 0;
    }

    // Update accumulated total pages
    jobState.totalPages += numPages;
    jobState.currentFile = fileName;
    jobState.logs.push(`Processing: ${fileName} (${numPages} page${numPages !== 1 ? 's' : ''})`);

    // Process each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        // Extract text using pdfjs-dist
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Reconstruct text with proper line breaks based on Y-position changes
        let pageText = '';
        let lastY = null;
        for (const item of textContent.items) {
          const y = item.transform ? item.transform[5] : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
            pageText += '\n';
          }
          pageText += item.str;
          if (y !== null) lastY = y;
        }

        // Optional: convert to image with poppler (Linux/Mac only)
        let imageBuffer = null;
        if (isPopplerAvailable()) {
          imageBuffer = convertPageToImageWithPoppler(pdfPath, pageNum, tmpDir);
        }

        // Run extraction logic (MOCK - plug in OCR/Vision API here)
        const extractedData = await extractDataFromImage(
          imageBuffer,
          pageText.trim(),
          { fileName, pageNum, totalPages: numPages }
        );

        // Format as JSONL and stream to disk
        const jsonlLine = formatToJsonl({
          source: pdfPath,
          page: pageNum,
          totalPages: numPages,
          extractedData
        });
        fs.appendFileSync(outputPath, jsonlLine + '\n');

        jobState.processedPages++;
        page.cleanup();
      } catch (pageErr) {
        jobState.processedPages++;
        const errMsg = (pageErr.message || String(pageErr)).substring(0, 120);
        jobState.errors.push(`${fileName} p${pageNum}: ${errMsg}`);
      }
    }

    doc.destroy();
    doc = null;
    return numPages;

  } catch (fileErr) {
    if (doc) {
      try { doc.destroy(); } catch {}
    }
    throw fileErr;
  }
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
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  // Also support Windows temp paths
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch (e) {
    // Try Windows-compatible path
    const winTmpDir = path.join(process.env.TEMP || process.env.TMP || '/tmp', 'pdf-processor', jobId);
    fs.mkdirSync(winTmpDir, { recursive: true });
  }

  try {
    // Step 1: Find all PDFs recursively (fast filesystem scan)
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

    // Step 2: Initialize job state
    // Note: totalPages starts at 0 and accumulates as we process each file
    // This avoids having to load every PDF just to count pages upfront
    const jobState = {
      status: 'processing',
      totalFiles: pdfFiles.length,
      processedFiles: 0,
      totalPages: 0,
      processedPages: 0,
      currentFile: '',
      errors: [],
      outputPath,
      logs: [
        `Found ${pdfFiles.length} PDF file(s)`,
        `Poppler image conversion: ${isPopplerAvailable() ? 'available' : 'not available (text-only mode)'}`,
      ],
    };
    activeJobs.set(jobId, jobState);
    await jobsCol.updateOne({ _id: jobId }, { $set: jobState });

    // Step 3: Process each PDF file sequentially
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfPath = pdfFiles[i];
      const fileName = path.basename(pdfPath);

      try {
        const numPages = await processSinglePdf(pdfPath, outputPath, tmpDir, jobState);
        jobState.processedFiles++;
        if (numPages > 0) {
          jobState.logs.push(`Completed: ${fileName}`);
        }
      } catch (fileError) {
        jobState.processedFiles++;
        const errMsg = (fileError.message || String(fileError)).substring(0, 120);
        jobState.errors.push(`Skipped: ${fileName} - ${errMsg}`);
        jobState.logs.push(`Skipped (error): ${fileName}`);
        console.error(`Error processing ${fileName}:`, fileError.message);
      }

      // Update MongoDB periodically (every 5 files or on last file)
      if (jobState.processedFiles % 5 === 0 || i === pdfFiles.length - 1) {
        await jobsCol.updateOne({ _id: jobId }, {
          $set: {
            processedFiles: jobState.processedFiles,
            processedPages: jobState.processedPages,
            totalPages: jobState.totalPages,
            currentFile: jobState.currentFile,
          }
        });
      }
    }

    // Step 4: Mark job as complete
    const outputStats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
    const finalState = {
      status: 'completed',
      processedFiles: jobState.processedFiles,
      processedPages: jobState.processedPages,
      totalPages: jobState.totalPages,
      outputSizeBytes: outputStats ? outputStats.size : 0,
      completedAt: new Date()
    };

    Object.assign(jobState, finalState);
    jobState.logs.push(
      `Job complete! ${jobState.processedPages} pages from ${jobState.processedFiles} files. Output: ${outputStats ? (outputStats.size / 1024).toFixed(1) + ' KB' : '0 KB'}`
    );

    await jobsCol.updateOne({ _id: jobId }, { $set: finalState });

  } catch (error) {
    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.status = 'failed';
      jobState.errors.push(`Fatal error: ${error.message}`);
      jobState.logs.push(`Job failed: ${error.message}`);
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
    if (method === 'GET' && pathSegments[0] === 'jobs' && pathSegments[1] === 'progress') {
      const url = new URL(request.url);
      const jobId = url.searchParams.get('jobId');

      if (!jobId) {
        return NextResponse.json(
          { error: 'jobId query parameter is required' },
          { status: 400, headers }
        );
      }

      let jobData = activeJobs.get(jobId);

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

      // Progress based on files (since total pages accumulates during processing)
      const totalFiles = jobData.totalFiles || 0;
      const processedFiles = jobData.processedFiles || 0;
      const progress = totalFiles > 0
        ? Math.round((processedFiles / totalFiles) * 100)
        : 0;

      return NextResponse.json({
        jobId,
        status: jobData.status,
        totalFiles,
        processedFiles,
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
        services: {
          database: 'connected',
          pdfjs: 'available',
          poppler: isPopplerAvailable() ? 'available' : 'not installed (text-only mode)',
        }
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
