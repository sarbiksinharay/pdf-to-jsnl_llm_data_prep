#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for PDF Processor
Tests all API endpoints with proper error handling and validation
"""

import requests
import json
import time
import sys
import os
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://document-extractor-8.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

class PDFProcessorTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'PDF-Processor-Test/1.0'
        })
        self.test_results = []
        self.current_job_id = None
        
    def log_result(self, test_name: str, success: bool, message: str, details: Dict = None):
        """Log test result"""
        result = {
            'test': test_name,
            'success': success,
            'message': message,
            'details': details or {}
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name} - {message}")
        if details and not success:
            print(f"   Details: {details}")
    
    def test_health_endpoint(self) -> bool:
        """Test GET /api/health endpoint"""
        try:
            response = self.session.get(f"{API_BASE}/health", timeout=10)
            
            if response.status_code != 200:
                self.log_result("Health Check", False, f"Expected 200, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            required_fields = ['status', 'timestamp', 'services']
            
            for field in required_fields:
                if field not in data:
                    self.log_result("Health Check", False, f"Missing required field: {field}", 
                                  {"response": data})
                    return False
            
            if data['status'] != 'ok':
                self.log_result("Health Check", False, f"Status not 'ok': {data['status']}", 
                              {"response": data})
                return False
            
            self.log_result("Health Check", True, "Health endpoint working correctly", 
                          {"response": data})
            return True
            
        except Exception as e:
            self.log_result("Health Check", False, f"Exception: {str(e)}")
            return False
    
    def test_generate_test_pdfs(self) -> bool:
        """Test POST /api/test/generate endpoint"""
        try:
            response = self.session.post(f"{API_BASE}/test/generate", timeout=30)
            
            if response.status_code != 200:
                self.log_result("Generate Test PDFs", False, f"Expected 200, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            required_fields = ['success', 'message', 'folderPath', 'files', 'totalPages']
            
            for field in required_fields:
                if field not in data:
                    self.log_result("Generate Test PDFs", False, f"Missing required field: {field}", 
                                  {"response": data})
                    return False
            
            if not data['success']:
                self.log_result("Generate Test PDFs", False, f"Generation failed: {data.get('message', 'Unknown error')}", 
                              {"response": data})
                return False
            
            # Validate expected values
            if data['folderPath'] != '/tmp/test-pdfs':
                self.log_result("Generate Test PDFs", False, f"Unexpected folderPath: {data['folderPath']}")
                return False
            
            if len(data['files']) != 4:
                self.log_result("Generate Test PDFs", False, f"Expected 4 files, got {len(data['files'])}")
                return False
            
            if data['totalPages'] != 8:
                self.log_result("Generate Test PDFs", False, f"Expected 8 total pages, got {data['totalPages']}")
                return False
            
            self.log_result("Generate Test PDFs", True, f"Generated {len(data['files'])} files with {data['totalPages']} pages", 
                          {"folderPath": data['folderPath'], "files": len(data['files'])})
            return True
            
        except Exception as e:
            self.log_result("Generate Test PDFs", False, f"Exception: {str(e)}")
            return False
    
    def test_start_job_valid_path(self) -> bool:
        """Test POST /api/jobs with valid folder path"""
        try:
            payload = {"folderPath": "/tmp/test-pdfs"}
            response = self.session.post(f"{API_BASE}/jobs", json=payload, timeout=10)
            
            if response.status_code != 200:
                self.log_result("Start Job (Valid Path)", False, f"Expected 200, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            required_fields = ['jobId', 'status', 'message']
            
            for field in required_fields:
                if field not in data:
                    self.log_result("Start Job (Valid Path)", False, f"Missing required field: {field}", 
                                  {"response": data})
                    return False
            
            if data['status'] != 'initializing':
                self.log_result("Start Job (Valid Path)", False, f"Expected status 'initializing', got '{data['status']}'", 
                              {"response": data})
                return False
            
            # Store job ID for progress testing
            self.current_job_id = data['jobId']
            
            self.log_result("Start Job (Valid Path)", True, f"Job started successfully with ID: {data['jobId'][:8]}...", 
                          {"jobId": data['jobId'], "status": data['status']})
            return True
            
        except Exception as e:
            self.log_result("Start Job (Valid Path)", False, f"Exception: {str(e)}")
            return False
    
    def test_start_job_invalid_path(self) -> bool:
        """Test POST /api/jobs with invalid folder path"""
        try:
            payload = {"folderPath": "/nonexistent/path"}
            response = self.session.post(f"{API_BASE}/jobs", json=payload, timeout=10)
            
            if response.status_code != 400:
                self.log_result("Start Job (Invalid Path)", False, f"Expected 400, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            if 'error' not in data:
                self.log_result("Start Job (Invalid Path)", False, "Missing error field in response", 
                              {"response": data})
                return False
            
            self.log_result("Start Job (Invalid Path)", True, "Correctly rejected invalid path", 
                          {"error": data['error']})
            return True
            
        except Exception as e:
            self.log_result("Start Job (Invalid Path)", False, f"Exception: {str(e)}")
            return False
    
    def test_start_job_missing_folder_path(self) -> bool:
        """Test POST /api/jobs with missing folderPath"""
        try:
            payload = {}
            response = self.session.post(f"{API_BASE}/jobs", json=payload, timeout=10)
            
            if response.status_code != 400:
                self.log_result("Start Job (Missing Path)", False, f"Expected 400, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            if 'error' not in data:
                self.log_result("Start Job (Missing Path)", False, "Missing error field in response", 
                              {"response": data})
                return False
            
            self.log_result("Start Job (Missing Path)", True, "Correctly rejected missing folderPath", 
                          {"error": data['error']})
            return True
            
        except Exception as e:
            self.log_result("Start Job (Missing Path)", False, f"Exception: {str(e)}")
            return False
    
    def test_job_progress_polling(self) -> bool:
        """Test GET /api/jobs/progress and poll until completion"""
        if not self.current_job_id:
            self.log_result("Job Progress Polling", False, "No job ID available for testing")
            return False
        
        try:
            max_polls = 60  # 2 minutes max
            poll_count = 0
            
            while poll_count < max_polls:
                response = self.session.get(f"{API_BASE}/jobs/progress?jobId={self.current_job_id}", timeout=10)
                
                if response.status_code != 200:
                    self.log_result("Job Progress Polling", False, f"Expected 200, got {response.status_code}", 
                                  {"response": response.text})
                    return False
                
                data = response.json()
                required_fields = ['jobId', 'status', 'totalFiles', 'processedFiles', 'totalPages', 'processedPages', 'progress', 'logs', 'errors']
                
                for field in required_fields:
                    if field not in data:
                        self.log_result("Job Progress Polling", False, f"Missing required field: {field}", 
                                      {"response": data})
                        return False
                
                status = data['status']
                progress = data['progress']
                
                print(f"   Poll {poll_count + 1}: Status={status}, Progress={progress}%, Files={data['processedFiles']}/{data['totalFiles']}, Pages={data['processedPages']}/{data['totalPages']}")
                
                if status == 'completed':
                    # Validate completion data
                    if data['totalFiles'] != 4:
                        self.log_result("Job Progress Polling", False, f"Expected 4 total files, got {data['totalFiles']}")
                        return False
                    
                    if data['totalPages'] != 8:
                        self.log_result("Job Progress Polling", False, f"Expected 8 total pages, got {data['totalPages']}")
                        return False
                    
                    if data['processedFiles'] != data['totalFiles']:
                        self.log_result("Job Progress Polling", False, f"Not all files processed: {data['processedFiles']}/{data['totalFiles']}")
                        return False
                    
                    if data['processedPages'] != data['totalPages']:
                        self.log_result("Job Progress Polling", False, f"Not all pages processed: {data['processedPages']}/{data['totalPages']}")
                        return False
                    
                    if progress != 100:
                        self.log_result("Job Progress Polling", False, f"Progress not 100% on completion: {progress}%")
                        return False
                    
                    self.log_result("Job Progress Polling", True, f"Job completed successfully in {poll_count + 1} polls", 
                                  {"totalFiles": data['totalFiles'], "totalPages": data['totalPages'], "errors": len(data['errors'])})
                    return True
                
                elif status == 'failed':
                    self.log_result("Job Progress Polling", False, f"Job failed: {data.get('errors', [])}")
                    return False
                
                poll_count += 1
                time.sleep(2)  # Wait 2 seconds between polls
            
            self.log_result("Job Progress Polling", False, f"Job did not complete within {max_polls} polls")
            return False
            
        except Exception as e:
            self.log_result("Job Progress Polling", False, f"Exception: {str(e)}")
            return False
    
    def test_job_progress_invalid_job_id(self) -> bool:
        """Test GET /api/jobs/progress with invalid job ID"""
        try:
            response = self.session.get(f"{API_BASE}/jobs/progress?jobId=invalid-job-id", timeout=10)
            
            if response.status_code != 404:
                self.log_result("Job Progress (Invalid ID)", False, f"Expected 404, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            if 'error' not in data:
                self.log_result("Job Progress (Invalid ID)", False, "Missing error field in response", 
                              {"response": data})
                return False
            
            self.log_result("Job Progress (Invalid ID)", True, "Correctly rejected invalid job ID", 
                          {"error": data['error']})
            return True
            
        except Exception as e:
            self.log_result("Job Progress (Invalid ID)", False, f"Exception: {str(e)}")
            return False
    
    def test_job_progress_missing_job_id(self) -> bool:
        """Test GET /api/jobs/progress without job ID parameter"""
        try:
            response = self.session.get(f"{API_BASE}/jobs/progress", timeout=10)
            
            if response.status_code != 400:
                self.log_result("Job Progress (Missing ID)", False, f"Expected 400, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            if 'error' not in data:
                self.log_result("Job Progress (Missing ID)", False, "Missing error field in response", 
                              {"response": data})
                return False
            
            self.log_result("Job Progress (Missing ID)", True, "Correctly rejected missing job ID", 
                          {"error": data['error']})
            return True
            
        except Exception as e:
            self.log_result("Job Progress (Missing ID)", False, f"Exception: {str(e)}")
            return False
    
    def test_download_jsonl(self) -> bool:
        """Test GET /api/jobs/download and validate JSONL format"""
        if not self.current_job_id:
            self.log_result("Download JSONL", False, "No job ID available for testing")
            return False
        
        try:
            response = self.session.get(f"{API_BASE}/jobs/download?jobId={self.current_job_id}", timeout=30)
            
            if response.status_code != 200:
                self.log_result("Download JSONL", False, f"Expected 200, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            # Check headers
            content_type = response.headers.get('content-type', '')
            if 'application/x-ndjson' not in content_type:
                self.log_result("Download JSONL", False, f"Expected JSONL content-type, got: {content_type}")
                return False
            
            content_disposition = response.headers.get('content-disposition', '')
            if 'attachment' not in content_disposition or '.jsonl' not in content_disposition:
                self.log_result("Download JSONL", False, f"Invalid content-disposition: {content_disposition}")
                return False
            
            # Validate JSONL content
            content = response.text
            lines = content.strip().split('\n')
            
            if len(lines) != 8:  # Should have 8 lines for 8 pages
                self.log_result("Download JSONL", False, f"Expected 8 lines, got {len(lines)}")
                return False
            
            valid_lines = 0
            for i, line in enumerate(lines):
                try:
                    data = json.loads(line)
                    
                    # Validate Hugging Face format
                    if 'messages' not in data:
                        self.log_result("Download JSONL", False, f"Line {i+1}: Missing 'messages' field")
                        return False
                    
                    if 'metadata' not in data:
                        self.log_result("Download JSONL", False, f"Line {i+1}: Missing 'metadata' field")
                        return False
                    
                    messages = data['messages']
                    if len(messages) != 3:
                        self.log_result("Download JSONL", False, f"Line {i+1}: Expected 3 messages, got {len(messages)}")
                        return False
                    
                    # Check message roles
                    expected_roles = ['system', 'user', 'assistant']
                    for j, msg in enumerate(messages):
                        if msg.get('role') != expected_roles[j]:
                            self.log_result("Download JSONL", False, f"Line {i+1}, Message {j+1}: Expected role '{expected_roles[j]}', got '{msg.get('role')}'")
                            return False
                        
                        if 'content' not in msg or not msg['content']:
                            self.log_result("Download JSONL", False, f"Line {i+1}, Message {j+1}: Missing or empty content")
                            return False
                    
                    # Validate metadata
                    metadata = data['metadata']
                    required_metadata = ['source_file', 'page_number', 'total_pages', 'confidence', 'extraction_method', 'timestamp']
                    for field in required_metadata:
                        if field not in metadata:
                            self.log_result("Download JSONL", False, f"Line {i+1}: Missing metadata field '{field}'")
                            return False
                    
                    valid_lines += 1
                    
                except json.JSONDecodeError as e:
                    self.log_result("Download JSONL", False, f"Line {i+1}: Invalid JSON - {str(e)}")
                    return False
            
            file_size = len(content.encode('utf-8'))
            self.log_result("Download JSONL", True, f"JSONL file downloaded and validated successfully", 
                          {"lines": valid_lines, "size_bytes": file_size, "content_type": content_type})
            return True
            
        except Exception as e:
            self.log_result("Download JSONL", False, f"Exception: {str(e)}")
            return False
    
    def test_download_invalid_job_id(self) -> bool:
        """Test GET /api/jobs/download with invalid job ID"""
        try:
            response = self.session.get(f"{API_BASE}/jobs/download?jobId=invalid-job-id", timeout=10)
            
            if response.status_code != 404:
                self.log_result("Download (Invalid ID)", False, f"Expected 404, got {response.status_code}", 
                              {"response": response.text})
                return False
            
            data = response.json()
            if 'error' not in data:
                self.log_result("Download (Invalid ID)", False, "Missing error field in response", 
                              {"response": data})
                return False
            
            self.log_result("Download (Invalid ID)", True, "Correctly rejected invalid job ID", 
                          {"error": data['error']})
            return True
            
        except Exception as e:
            self.log_result("Download (Invalid ID)", False, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all backend tests in the correct order"""
        print(f"🚀 Starting PDF Processor Backend Tests")
        print(f"📍 Base URL: {BASE_URL}")
        print(f"🔗 API Base: {API_BASE}")
        print("=" * 60)
        
        # Test sequence following the end-to-end flow
        tests = [
            ("Health Check", self.test_health_endpoint),
            ("Generate Test PDFs", self.test_generate_test_pdfs),
            ("Start Job (Valid Path)", self.test_start_job_valid_path),
            ("Start Job (Invalid Path)", self.test_start_job_invalid_path),
            ("Start Job (Missing Path)", self.test_start_job_missing_folder_path),
            ("Job Progress Polling", self.test_job_progress_polling),
            ("Job Progress (Invalid ID)", self.test_job_progress_invalid_job_id),
            ("Job Progress (Missing ID)", self.test_job_progress_missing_job_id),
            ("Download JSONL", self.test_download_jsonl),
            ("Download (Invalid ID)", self.test_download_invalid_job_id),
        ]
        
        passed = 0
        failed = 0
        
        for test_name, test_func in tests:
            try:
                success = test_func()
                if success:
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"❌ FAIL: {test_name} - Unexpected exception: {str(e)}")
                failed += 1
            
            print()  # Add spacing between tests
        
        # Summary
        print("=" * 60)
        print(f"📊 TEST SUMMARY")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"📈 Success Rate: {(passed / (passed + failed) * 100):.1f}%")
        
        if failed > 0:
            print("\n🔍 FAILED TESTS:")
            for result in self.test_results:
                if not result['success']:
                    print(f"   • {result['test']}: {result['message']}")
        
        return failed == 0

def main():
    """Main test runner"""
    tester = PDFProcessorTester()
    success = tester.run_all_tests()
    
    if success:
        print("\n🎉 All tests passed!")
        sys.exit(0)
    else:
        print("\n💥 Some tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()