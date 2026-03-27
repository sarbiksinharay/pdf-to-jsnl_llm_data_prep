'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FolderSearch,
  Play,
  Download,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Sparkles,
  Zap,
  AlertTriangle,
  ChevronRight,
  RotateCcw,
  FlaskConical
} from 'lucide-react';

export default function App() {
  const [folderPath, setFolderPath] = useState('');
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingTests, setIsGeneratingTests] = useState(false);
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);
  const logsEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [progress?.logs]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Poll for progress
  const startPolling = useCallback((id) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/progress?jobId=${id}`);
        if (!res.ok) throw new Error('Failed to fetch progress');
        const data = await res.json();
        setProgress(data);

        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setIsProcessing(false);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    // Immediate first poll
    poll();
    pollIntervalRef.current = setInterval(poll, 800);
  }, []);

  // Generate test PDFs
  const generateTestPdfs = async () => {
    setIsGeneratingTests(true);
    setError(null);
    try {
      const res = await fetch('/api/test/generate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolderPath(data.folderPath);
      setProgress(prev => ({
        ...prev,
        status: 'idle',
        logs: [`Generated ${data.files.length} test PDFs in ${data.folderPath}`, `Total pages: ${data.totalPages}`, 'Ready to process!']
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGeneratingTests(false);
    }
  };

  // Start processing
  const startProcessing = async () => {
    if (!folderPath.trim()) {
      setError('Please enter a folder path');
      return;
    }

    setError(null);
    setIsProcessing(true);
    setProgress(null);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folderPath.trim() })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setJobId(data.jobId);
      startPolling(data.jobId);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  // Download JSONL
  const downloadJsonl = () => {
    if (!jobId) return;
    window.open(`/api/jobs/download?jobId=${jobId}`, '_blank');
  };

  // Reset
  const resetJob = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setJobId(null);
    setProgress(null);
    setIsProcessing(false);
    setError(null);
  };

  const isComplete = progress?.status === 'completed';
  const isFailed = progress?.status === 'failed';
  const progressPercent = progress?.progress || 0;

  return (
    <div className="min-h-screen bg-[#09090b] relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-violet-600/[0.03] blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/[0.03] blur-[120px]" />
      </div>

      {/* Main content */}
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass mb-4">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-medium text-zinc-400">LLM Training Data Pipeline</span>
          </div>
          <h1 className="text-3xl font-semibold text-zinc-100 tracking-tight">
            PDF <span className="text-gradient">Processor</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-500 max-w-md mx-auto">
            Convert PDF documents into structured JSONL training data for fine-tuning language models
          </p>
        </div>

        {/* Main card */}
        <div className="glass-strong rounded-xl p-6 glow-blurple">
          {/* Input section */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <FolderSearch className="w-3.5 h-3.5" />
              Folder Path
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="/path/to/your/pdf/directory"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  disabled={isProcessing}
                  className="bg-zinc-900/80 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 h-11 font-mono text-sm focus:ring-violet-500/30 focus:border-violet-500/50"
                  onKeyDown={(e) => e.key === 'Enter' && !isProcessing && startProcessing()}
                />
              </div>
              <Button
                onClick={startProcessing}
                disabled={isProcessing || !folderPath.trim()}
                className="h-11 px-5 gradient-blurple hover:opacity-90 text-white font-medium transition-all disabled:opacity-30"
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing</>
                ) : (
                  <><Play className="w-4 h-4 mr-2" /> Start Processing</>
                )}
              </Button>
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={generateTestPdfs}
                disabled={isProcessing || isGeneratingTests}
                className="h-7 text-xs text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10"
              >
                {isGeneratingTests ? (
                  <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Generating...</>
                ) : (
                  <><FlaskConical className="w-3 h-3 mr-1.5" /> Generate Test PDFs</>
                )}
              </Button>
              {(jobId || progress) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetJob}
                  disabled={isProcessing}
                  className="h-7 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                >
                  <RotateCcw className="w-3 h-3 mr-1.5" /> Reset
                </Button>
              )}
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 animate-slide-up">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
          )}

          {/* Progress section */}
          {progress && progress.status !== 'idle' && (
            <div className="mt-6 space-y-4 animate-slide-up">
              <Separator className="bg-zinc-800/50" />

              {/* Status header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isComplete ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : isFailed ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                  )}
                  <span className="text-sm font-medium text-zinc-300">
                    {isComplete ? 'Processing Complete' : isFailed ? 'Processing Failed' : 'Processing...'}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs font-mono ${
                    isComplete
                      ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      : isFailed
                      ? 'border-red-500/30 text-red-400 bg-red-500/10'
                      : 'border-violet-500/30 text-violet-400 bg-violet-500/10'
                  }`}
                >
                  {progressPercent}%
                </Badge>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800/80">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${
                      isComplete
                        ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                        : isFailed
                        ? 'bg-gradient-to-r from-red-500 to-red-400'
                        : 'bg-gradient-to-r from-violet-600 via-indigo-500 to-violet-400'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                  {!isComplete && !isFailed && progressPercent > 0 && (
                    <div
                      className="absolute top-0 h-full w-20 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse"
                      style={{ left: `${Math.max(0, progressPercent - 10)}%` }}
                    />
                  )}
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-mono">
                    {progress.currentFile && !isComplete ? (
                      <span className="flex items-center gap-1">
                        <ChevronRight className="w-3 h-3 text-violet-400" />
                        <span className="text-zinc-400">{progress.currentFile}</span>
                      </span>
                    ) : isComplete ? (
                      'All files processed'
                    ) : (
                      'Initializing...'
                    )}
                  </span>
                  <span className="font-mono">
                    {progress.processedPages}/{progress.totalPages} pages
                    <span className="text-zinc-600 mx-1.5">&middot;</span>
                    {progress.processedFiles}/{progress.totalFiles} files
                  </span>
                </div>
              </div>

              {/* Errors */}
              {progress.errors && progress.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400">
                      {progress.errors.length} warning{progress.errors.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {progress.errors.map((err, i) => (
                      <p key={i} className="text-xs text-amber-300/70 font-mono">{err}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Log output */}
              {progress.logs && progress.logs.length > 0 && (
                <div className="rounded-lg bg-zinc-950/80 border border-zinc-800/50 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/50 bg-zinc-900/50">
                    <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs font-medium text-zinc-500">Output</span>
                  </div>
                  <ScrollArea className="h-[180px]">
                    <div className="p-3 space-y-0.5">
                      {progress.logs.map((log, i) => (
                        <div key={i} className="flex items-start gap-2 animate-slide-up">
                          <span className="text-zinc-700 text-[10px] font-mono mt-0.5 select-none w-4 text-right shrink-0">
                            {i + 1}
                          </span>
                          <p className={`text-xs font-mono leading-relaxed ${
                            log.startsWith('Error') || log.startsWith('Skipped')
                              ? 'text-red-400/80'
                              : log.startsWith('Completed') || log.startsWith('Job complete')
                              ? 'text-emerald-400/80'
                              : log.startsWith('Processing:')
                              ? 'text-violet-400/80'
                              : 'text-zinc-500'
                          }`}>
                            {log}
                          </p>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Download button */}
              {isComplete && progress.processedPages > 0 && (
                <div className="pt-2 animate-slide-up">
                  <Button
                    onClick={downloadJsonl}
                    className="w-full h-11 gradient-blurple hover:opacity-90 text-white font-medium transition-all"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download JSONL
                    {progress.outputSizeBytes > 0 && (
                      <span className="ml-2 text-xs opacity-70">
                        ({(progress.outputSizeBytes / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </Button>
                  <p className="mt-2 text-center text-xs text-zinc-600">
                    Hugging Face compatible training data &middot; {progress.processedPages} entries
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info footer */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          {[
            { icon: FileText, label: 'PDF to Image', desc: 'Converts pages via poppler' },
            { icon: Zap, label: 'Data Extraction', desc: 'Mock OCR pipeline' },
            { icon: Sparkles, label: 'JSONL Output', desc: 'HuggingFace format' },
          ].map(({ icon: Icon, label, desc }, i) => (
            <div key={i} className="glass rounded-lg p-3 text-center">
              <Icon className="w-4 h-4 text-violet-400/70 mx-auto mb-1.5" />
              <p className="text-xs font-medium text-zinc-400">{label}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{desc}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-[11px] text-zinc-700">
          Built for LLM training workflows &middot; Extraction function is <span className="text-violet-500/60">mocked</span> &mdash; plug in your OCR/Vision API key
        </p>
      </div>
    </div>
  );
}
