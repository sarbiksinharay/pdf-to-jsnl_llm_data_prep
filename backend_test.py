#!/usr/bin/env python3
"""
Comprehensive Backend API Test Suite for PDF Processor
Tests the updated pdfjs-dist implementation (cross-platform)
"""

import requests
import json
import time
import sys
from typing import Dict, Any, Optional

# Base URL from environment
BASE_URL = "https://document-extractor-8.preview.emergentagent.com"

class PDFProcessorTester:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'PDF-Processor-Test/1.0'
        })
        
    def log(self, message: str, level: str = "INFO"):
        """Log test messages with timestamp"""
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def test_health_check(self) -> bool:
        """Test GET /api/health endpoint"""
        self.log("Testing health check endpoint...")
        try:
            response = self.session.get(f"{self.base_url}/api/health", timeout=10)
            
            if response.status_code != 200:
                self.log(f"❌ Health check failed with status {response.status_code}", "ERROR")
                return False
                
            data = response.json()
            required_fields = ['status', 'timestamp', 'services']
            
            for field in required_fields:
                if field not in data:
                    self.log(f"❌ Health check missing field: {field}", "ERROR")
                    return False
                    
            if data['status'] != 'ok':
                self.log(f"❌ Health check status not ok: {data['status']}", "ERROR")
                return False
                
            # Check services
            services = data.get('services', {})
            expected_services = ['database', 'pdfjs', 'poppler']
            
            for service in expected_services:
                if service not in services:
                    self.log(f"❌ Health check missing service: {service}", "ERROR")
                    return False
                    
            self.log(f"✅ Health check passed - Status: {data['status']}")
            self.log(f"   Services: {services}")
            return True
            
        except Exception as e:
            self.log(f"❌ Health check exception: {str(e)}", "ERROR")
            return False
            
    def test_generate_test_pdfs(self) -> Optional[Dict[str, Any]]:
        """Test POST /api/test/generate endpoint"""
        self.log("Testing test PDF generation...")
        try:
            response = self.session.post(f"{self.base_url}/api/test/generate", timeout=30)
            
            if response.status_code != 200:
                self.log(f"❌ Test PDF generation failed with status {response.status_code}", "ERROR")
                self.log(f"   Response: {response.text}", "ERROR")
                return None
                
            data = response.json()
            required_fields = ['success', 'message', 'folderPath', 'files', 'totalPages']
            
            for field in required_fields:
                if field not in data:
                    self.log(f"❌ Test PDF generation missing field: {field}", "ERROR")
                    return None
                    
            if not data['success']:
                self.log(f"❌ Test PDF generation failed: {data.get('message', 'Unknown error')}", "ERROR")
                return None
                
            if data['totalPages'] <= 0:
                self.log(f"❌ Test PDF generation returned 0 pages", "ERROR")
                return None
                
            self.log(f"✅ Test PDF generation passed")
            self.log(f"   Folder: {data['folderPath']}")
            self.log(f"   Files: {len(data['files'])}")
            self.log(f"   Total Pages: {data['totalPages']}")
            return data
            
        except Exception as e:
            self.log(f"❌ Test PDF generation exception: {str(e)}", "ERROR")
            return None
            
    def test_create_job_valid_path(self, folder_path: str) -> Optional[str]:
        """Test POST /api/jobs with valid folder path"""
        self.log(f"Testing job creation with valid path: {folder_path}")
        try:
            payload = {"folderPath": folder_path}
            response = self.session.post(f"{self.base_url}/api/jobs", 
                                       json=payload, timeout=10)
            
            if response.status_code != 200:
                self.log(f"❌ Job creation failed with status {response.status_code}", "ERROR")
                self.log(f"   Response: {response.text}", "ERROR")
                return None
                
            data = response.json()
            required_fields = ['jobId', 'status', 'message']
            
            for field in required_fields:
                if field not in data:
                    self.log(f"❌ Job creation missing field: {field}", "ERROR")
                    return None
                    
            if data['status'] != 'initializing':
                self.log(f"❌ Job creation wrong status: {data['status']}", "ERROR")
                return None
                
            job_id = data['jobId']
            if not job_id or len(job_id) < 10:
                self.log(f"❌ Job creation invalid jobId: {job_id}", "ERROR")
                return None
                
            self.log(f"✅ Job creation passed - JobId: {job_id}")
            return job_id
            
        except Exception as e:
            self.log(f"❌ Job creation exception: {str(e)}", "ERROR")
            return None
            
    def test_create_job_invalid_paths(self) -> bool:
        """Test POST /api/jobs with invalid paths"""
        self.log("Testing job creation with invalid paths...")
        
        test_cases = [
            {"folderPath": "/nonexistent/path", "expected_status": 400, "description": "non-existent path"},
            {"folderPath": "", "expected_status": 400, "description": "empty path"},
            {"folderPath": "/etc/passwd", "expected_status": 400, "description": "file instead of directory"},
            {}, # missing folderPath
        ]
        
        all_passed = True
        
        for i, test_case in enumerate(test_cases):
            try:
                description = test_case.get("description", f"test case {i+1}")
                expected_status = test_case.get("expected_status", 400)
                
                response = self.session.post(f"{self.base_url}/api/jobs", 
                                           json=test_case if "folderPath" in test_case else {}, 
                                           timeout=10)
                
                if response.status_code != expected_status:
                    self.log(f"❌ Invalid path test failed ({description}): expected {expected_status}, got {response.status_code}", "ERROR")
                    all_passed = False
                else:
                    self.log(f"✅ Invalid path test passed ({description})")
                    
            except Exception as e:
                self.log(f"❌ Invalid path test exception ({description}): {str(e)}", "ERROR")
                all_passed = False
                
        return all_passed
        
    def test_job_progress(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Test GET /api/jobs/progress and poll until completion"""
        self.log(f"Testing job progress polling for job: {job_id}")
        
        max_polls = 30  # 60 seconds max
        poll_interval = 2
        
        for poll_count in range(max_polls):
            try:
                response = self.session.get(f"{self.base_url}/api/jobs/progress?jobId={job_id}", 
                                          timeout=10)
                
                if response.status_code != 200:
                    self.log(f"❌ Progress polling failed with status {response.status_code}", "ERROR")
                    return None
                    
                data = response.json()
                required_fields = ['jobId', 'status', 'totalFiles', 'processedFiles', 
                                 'totalPages', 'processedPages', 'progress']
                
                for field in required_fields:
                    if field not in data:
                        self.log(f"❌ Progress polling missing field: {field}", "ERROR")
                        return None
                        
                status = data['status']
                progress = data['progress']
                total_pages = data['totalPages']
                processed_pages = data['processedPages']
                
                self.log(f"   Poll {poll_count + 1}: Status={status}, Progress={progress}%, Pages={processed_pages}/{total_pages}")
                
                if status == 'completed':
                    if total_pages <= 0:
                        self.log(f"❌ Job completed but totalPages is {total_pages}", "ERROR")
                        return None
                        
                    self.log(f"✅ Job progress polling completed successfully")
                    self.log(f"   Final stats: {data['processedFiles']}/{data['totalFiles']} files, {processed_pages}/{total_pages} pages")
                    return data
                    
                elif status == 'failed':
                    self.log(f"❌ Job failed during processing", "ERROR")
                    if 'errors' in data and data['errors']:
                        self.log(f"   Errors: {data['errors']}", "ERROR")
                    return None
                    
                elif status in ['initializing', 'processing']:
                    time.sleep(poll_interval)
                    continue
                else:
                    self.log(f"❌ Unknown job status: {status}", "ERROR")
                    return None
                    
            except Exception as e:
                self.log(f"❌ Progress polling exception: {str(e)}", "ERROR")
                return None
                
        self.log(f"❌ Job progress polling timed out after {max_polls * poll_interval} seconds", "ERROR")
        return None
        
    def test_job_progress_invalid_cases(self) -> bool:
        """Test GET /api/jobs/progress with invalid cases"""
        self.log("Testing job progress with invalid cases...")
        
        test_cases = [
            {"jobId": "", "description": "empty jobId"},
            {"jobId": "nonexistent-job-id", "description": "non-existent jobId"},
            # Missing jobId parameter
        ]
        
        all_passed = True
        
        # Test missing jobId parameter
        try:
            response = self.session.get(f"{self.base_url}/api/jobs/progress", timeout=10)
            if response.status_code != 400:
                self.log(f"❌ Missing jobId test failed: expected 400, got {response.status_code}", "ERROR")
                all_passed = False
            else:
                self.log(f"✅ Missing jobId test passed")
        except Exception as e:
            self.log(f"❌ Missing jobId test exception: {str(e)}", "ERROR")
            all_passed = False
            
        # Test other invalid cases
        for test_case in test_cases:
            try:
                job_id = test_case["jobId"]
                description = test_case["description"]
                
                response = self.session.get(f"{self.base_url}/api/jobs/progress?jobId={job_id}", 
                                          timeout=10)
                
                if job_id == "":
                    expected_status = 400
                else:
                    expected_status = 404
                    
                if response.status_code != expected_status:
                    self.log(f"❌ Invalid progress test failed ({description}): expected {expected_status}, got {response.status_code}", "ERROR")
                    all_passed = False
                else:
                    self.log(f"✅ Invalid progress test passed ({description})")
                    
            except Exception as e:
                self.log(f"❌ Invalid progress test exception ({description}): {str(e)}", "ERROR")
                all_passed = False
                
        return all_passed
        
    def test_download_jsonl(self, job_id: str) -> bool:
        """Test GET /api/jobs/download endpoint"""
        self.log(f"Testing JSONL download for job: {job_id}")
        try:
            response = self.session.get(f"{self.base_url}/api/jobs/download?jobId={job_id}", 
                                      timeout=30)
            
            if response.status_code != 200:
                self.log(f"❌ JSONL download failed with status {response.status_code}", "ERROR")
                self.log(f"   Response: {response.text}", "ERROR")
                return False
                
            # Check headers
            content_type = response.headers.get('content-type', '')
            if 'application/x-ndjson' not in content_type:
                self.log(f"❌ JSONL download wrong content-type: {content_type}", "ERROR")
                return False
                
            content_disposition = response.headers.get('content-disposition', '')
            if 'attachment' not in content_disposition:
                self.log(f"❌ JSONL download missing attachment header", "ERROR")
                return False
                
            # Check content
            content = response.text
            if not content.strip():
                self.log(f"❌ JSONL download empty content", "ERROR")
                return False
                
            # Validate JSONL format
            lines = content.strip().split('\n')
            valid_lines = 0
            
            for i, line in enumerate(lines):
                if not line.strip():
                    continue
                    
                try:
                    data = json.loads(line)
                    
                    # Check required fields for Hugging Face format
                    if 'messages' not in data:
                        self.log(f"❌ JSONL line {i+1} missing 'messages' field", "ERROR")
                        return False
                        
                    if 'metadata' not in data:
                        self.log(f"❌ JSONL line {i+1} missing 'metadata' field", "ERROR")
                        return False
                        
                    messages = data['messages']
                    if not isinstance(messages, list) or len(messages) != 3:
                        self.log(f"❌ JSONL line {i+1} invalid messages format", "ERROR")
                        return False
                        
                    # Check message roles
                    expected_roles = ['system', 'user', 'assistant']
                    for j, msg in enumerate(messages):
                        if msg.get('role') != expected_roles[j]:
                            self.log(f"❌ JSONL line {i+1} message {j+1} wrong role: {msg.get('role')}", "ERROR")
                            return False
                            
                    valid_lines += 1
                    
                except json.JSONDecodeError as e:
                    self.log(f"❌ JSONL line {i+1} invalid JSON: {str(e)}", "ERROR")
                    return False
                    
            if valid_lines == 0:
                self.log(f"❌ JSONL download no valid lines found", "ERROR")
                return False
                
            self.log(f"✅ JSONL download passed")
            self.log(f"   Content-Type: {content_type}")
            self.log(f"   Size: {len(content)} bytes")
            self.log(f"   Valid lines: {valid_lines}")
            return True
            
        except Exception as e:
            self.log(f"❌ JSONL download exception: {str(e)}", "ERROR")
            return False
            
    def test_download_invalid_cases(self) -> bool:
        """Test GET /api/jobs/download with invalid cases"""
        self.log("Testing JSONL download with invalid cases...")
        
        test_cases = [
            {"jobId": "", "description": "empty jobId"},
            {"jobId": "nonexistent-job-id", "description": "non-existent jobId"},
        ]
        
        all_passed = True
        
        # Test missing jobId parameter
        try:
            response = self.session.get(f"{self.base_url}/api/jobs/download", timeout=10)
            if response.status_code != 400:
                self.log(f"❌ Missing jobId download test failed: expected 400, got {response.status_code}", "ERROR")
                all_passed = False
            else:
                self.log(f"✅ Missing jobId download test passed")
        except Exception as e:
            self.log(f"❌ Missing jobId download test exception: {str(e)}", "ERROR")
            all_passed = False
            
        # Test other invalid cases
        for test_case in test_cases:
            try:
                job_id = test_case["jobId"]
                description = test_case["description"]
                
                response = self.session.get(f"{self.base_url}/api/jobs/download?jobId={job_id}", 
                                          timeout=10)
                
                if job_id == "":
                    expected_status = 400
                else:
                    expected_status = 404
                    
                if response.status_code != expected_status:
                    self.log(f"❌ Invalid download test failed ({description}): expected {expected_status}, got {response.status_code}", "ERROR")
                    all_passed = False
                else:
                    self.log(f"✅ Invalid download test passed ({description})")
                    
            except Exception as e:
                self.log(f"❌ Invalid download test exception ({description}): {str(e)}", "ERROR")
                all_passed = False
                
        return all_passed
        
    def run_comprehensive_test(self) -> Dict[str, bool]:
        """Run all tests in sequence"""
        self.log("=" * 60)
        self.log("STARTING COMPREHENSIVE PDF PROCESSOR BACKEND TESTS")
        self.log(f"Base URL: {self.base_url}")
        self.log("=" * 60)
        
        results = {}
        
        # Test 1: Health Check
        results['health_check'] = self.test_health_check()
        
        # Test 2: Generate Test PDFs
        pdf_data = self.test_generate_test_pdfs()
        results['generate_test_pdfs'] = pdf_data is not None
        
        if not pdf_data:
            self.log("❌ Cannot continue tests without test PDFs", "ERROR")
            return results
            
        folder_path = pdf_data['folderPath']
        
        # Test 3: Create Job with Valid Path
        job_id = self.test_create_job_valid_path(folder_path)
        results['create_job_valid'] = job_id is not None
        
        # Test 4: Create Job with Invalid Paths
        results['create_job_invalid'] = self.test_create_job_invalid_paths()
        
        if not job_id:
            self.log("❌ Cannot continue tests without valid job", "ERROR")
            return results
            
        # Test 5: Job Progress Polling
        final_job_data = self.test_job_progress(job_id)
        results['job_progress'] = final_job_data is not None
        
        # Test 6: Job Progress Invalid Cases
        results['job_progress_invalid'] = self.test_job_progress_invalid_cases()
        
        if not final_job_data:
            self.log("❌ Cannot test download without completed job", "ERROR")
            return results
            
        # Test 7: Download JSONL
        results['download_jsonl'] = self.test_download_jsonl(job_id)
        
        # Test 8: Download Invalid Cases
        results['download_invalid'] = self.test_download_invalid_cases()
        
        return results
        
    def print_summary(self, results: Dict[str, bool]):
        """Print test summary"""
        self.log("=" * 60)
        self.log("TEST SUMMARY")
        self.log("=" * 60)
        
        total_tests = len(results)
        passed_tests = sum(1 for result in results.values() if result)
        
        for test_name, passed in results.items():
            status = "✅ PASS" if passed else "❌ FAIL"
            self.log(f"{status}: {test_name}")
            
        self.log("-" * 60)
        self.log(f"TOTAL: {passed_tests}/{total_tests} tests passed")
        
        if passed_tests == total_tests:
            self.log("🎉 ALL TESTS PASSED! Backend is working correctly.", "SUCCESS")
            return True
        else:
            self.log(f"⚠️  {total_tests - passed_tests} test(s) failed. Backend needs attention.", "WARNING")
            return False

def main():
    """Main test execution"""
    tester = PDFProcessorTester(BASE_URL)
    
    try:
        results = tester.run_comprehensive_test()
        all_passed = tester.print_summary(results)
        
        # Exit with appropriate code
        sys.exit(0 if all_passed else 1)
        
    except KeyboardInterrupt:
        tester.log("Tests interrupted by user", "WARNING")
        sys.exit(1)
    except Exception as e:
        tester.log(f"Test suite failed with exception: {str(e)}", "ERROR")
        sys.exit(1)

if __name__ == "__main__":
    main()