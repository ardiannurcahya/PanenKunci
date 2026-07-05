import urllib.request
import urllib.parse
import json
import uuid
import time
import re
import html

class TempMail:
    SUPABASE_URL = "https://ijrccpgiulrmfpavazsl.supabase.co"
    ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqcmNjcGdpdWxybWZwYXZhenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDMwNTUsImV4cCI6MjA4ODIxOTA1NX0.ljpHFR3iy8hIqU2ddOCwKmP77xbN8-lk8MpCpuPO6tc"
    
    def __init__(self, owner_token=None):
        # Generate custom owner token if not provided (same pattern as original site)
        if owner_token is None:
            self.owner_token = str(uuid.uuid4()) + str(uuid.uuid4()).replace('-', '')
        else:
            self.owner_token = owner_token

    def _request(self, endpoint, method="GET", data=None, headers=None, is_edge_function=False):
        if is_edge_function:
            url = f"{self.SUPABASE_URL}/functions/v1/{endpoint}"
        else:
            url = f"{self.SUPABASE_URL}/rest/v1/{endpoint}"
            
        req_headers = {
            "apikey": self.ANON_KEY,
            "Authorization": f"Bearer {self.ANON_KEY}",
            "Content-Type": "application/json"
        }
        if headers:
            req_headers.update(headers)
            
        req_data = None
        if data is not None:
            req_data = json.dumps(data).encode("utf-8")
            
        req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req) as response:
                status = response.status
                body = response.read().decode("utf-8")
                if status >= 200 and status < 300:
                    return json.loads(body) if body else {}
                else:
                    raise Exception(f"HTTP Error {status}: {body}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise Exception(f"Request failed with status {e.code}: {err_body}")

    def get_domains(self, include_vip=False):
        """Fetches list of active domains from Supabase"""
        endpoint = "temp_domains?select=domain,label,vip_only&is_active=eq.true&order=sort_order.asc"
        domains = self._request(endpoint)
        if not include_vip:
            domains = [d for d in domains if not d.get("vip_only", False)]
        return domains

    def create_inbox(self, desired_local=None, domain=None):
        """Creates a temporary mailbox. Picks random domain if none provided."""
        if not domain:
            active_domains = self.get_domains(include_vip=False)
            if not active_domains:
                raise Exception("No active domains found")
            domain = active_domains[0]["domain"]
            
        if not desired_local:
            desired_local = f"user_{str(uuid.uuid4())[:8]}"
            
        payload = {
            "owner_token": self.owner_token,
            "desired_local": desired_local,
            "domain": domain
        }
        
        # Call the edge function generate-inbox
        res = self._request("generate-inbox", method="POST", data=payload, is_edge_function=True)
        return res

    def get_messages(self, address):
        """Fetches messages for the given email address"""
        encoded_address = urllib.parse.quote(address)
        endpoint = f"temp_messages?select=*&inbox_address=eq.{encoded_address}&order=received_at.desc"
        return self._request(endpoint)

    @staticmethod
    def clean_html(raw_html):
        """Clean HTML tag structure similar to the frontend's cleanup function"""
        if not raw_html:
            return ""
        # Remove style and script tags
        raw_html = re.sub(r'<style[\s\S]*?</style>', ' ', raw_html, flags=re.IGNORECASE)
        raw_html = re.sub(r'<script[\s\S]*?</script>', ' ', raw_html, flags=re.IGNORECASE)
        # Remove href/src attributes
        raw_html = re.sub(r'\s(?:href|src|action|data-[\w-]+)\s*=\s*"[^"]*"', ' ', raw_html, flags=re.IGNORECASE)
        raw_html = re.sub(r'\s(?:href|src|action|data-[\w-]+)\s*=\s*\'[^\']*\'', ' ', raw_html, flags=re.IGNORECASE)
        # Remove HTML tags
        raw_html = re.sub(r'<[^>]+>', ' ', raw_html)
        # Remove HTTP URLs
        raw_html = re.sub(r'https?://\S+', ' ', raw_html, flags=re.IGNORECASE)
        
        # Replace entities
        raw_html = html.unescape(raw_html)
        raw_html = raw_html.replace('\xa0', ' ')
        raw_html = re.sub(r'&zwnj;|&zwj;', '', raw_html, flags=re.IGNORECASE)
        return raw_html

    @staticmethod
    def normalize_digits(text):
        """Normalizes spaces/dashes between digits to handle space-spaced OTPs (e.g. 1 2 3 4 -> 1234)"""
        # Replaces digit-space-digit patterns
        def merge_digits(match):
            merged = re.sub(r'[\s\-]+', '', match.group(0))
            if 4 <= len(merged) <= 8:
                return merged
            return match.group(0)
            
        # Match digits separated by spaces or dashes
        text = re.sub(r'(?:\d[\s\-]+){3,7}\d', merge_digits, text)
        text = re.sub(r'\b\d{2,4}(?:[\s\-]+\d{2,4}){1,3}\b', merge_digits, text)
        return text

    @staticmethod
    def is_year(code):
        if len(code) != 4:
            return False
        try:
            val = int(code)
            return 1900 <= val <= 2099
        except ValueError:
            return False

    @classmethod
    def filter_codes(cls, codes):
        valid = [c for c in codes if not cls.is_year(c)]
        if not valid:
            return None
        # Prefer 6 digit code if exists
        six_digit = [c for c in valid if len(c) == 6]
        if six_digit:
            return six_digit[0]
        return valid[0]

    @classmethod
    def extract_otp(cls, subject, text_body, html_body):
        """Extracts OTP/Verification Code from email parts"""
        parts = [p for p in [subject, text_body, html_body] if p]
        content = "\n".join(parts)
        if not content:
            return None
            
        cleaned = cls.normalize_digits(cls.clean_html(content))
        keyword_pattern = r"(?:otp|kode|code|verif(?:y|ication|ikasi)?|pin|password|passcode|security|launch\s+code|one[-\s]?time(?:\s+code|\s+password)?|2fa)"
        
        # Pattern 1: Keyword followed by digits within 40 characters
        pattern1 = re.compile(f"{keyword_pattern}[^\\\\d\\\\n]{{0,40}}(\\\\d{{4,8}})\\\\b", re.IGNORECASE)
        matches1 = pattern1.findall(cleaned)
        otp = cls.filter_codes(matches1)
        if otp:
            return otp
            
        # Pattern 2: Digits followed by keyword within 40 characters
        pattern2 = re.compile(f"\\\\b(\\\\d{{4,8}})\\\\b[^\\\\d\\\\n]{{0,40}}{keyword_pattern}", re.IGNORECASE)
        matches2 = pattern2.findall(cleaned)
        otp = cls.filter_codes(matches2)
        if otp:
            return otp
            
        # Pattern 3: Fallback to any 4-8 digit number
        matches3 = re.findall(r"\b\d{4,8}\b", cleaned)
        return cls.filter_codes(matches3)

    def wait_for_email(self, address, timeout=120, poll_interval=5):
        """Polls for new emails until timeout or an email is received"""
        start_time = time.time()
        print(f"Waiting for emails on {address} (Timeout: {timeout}s)...")
        while time.time() - start_time < timeout:
            try:
                messages = self.get_messages(address)
                if messages:
                    return messages[0]  # Return the latest message
            except Exception as e:
                print(f"Polling error: {e}")
            time.sleep(poll_interval)
        return None

    def wait_for_otp(self, address, timeout=120, poll_interval=5):
        """Polls and automatically extracts OTP from incoming email"""
        msg = self.wait_for_email(address, timeout, poll_interval)
        if msg:
            print(f"Received email from: {msg.get('from_address')} - Subject: {msg.get('subject')}")
            otp = self.extract_otp(
                msg.get("subject"), 
                msg.get("text_body"), 
                msg.get("html_body")
            )
            return otp
        return None

if __name__ == "__main__":
    import sys
    
    client = TempMail()
    
    if len(sys.argv) > 1 and sys.argv[1] == "domains":
        print("Fetching active domains...")
        try:
            for d in client.get_domains():
                print(f"- {d['domain']} ({d['label']})")
        except Exception as e:
            print("Error:", e)
            
    elif len(sys.argv) > 1 and sys.argv[1] == "listen":
        if len(sys.argv) < 3:
            print("Usage: python tempmail.py listen <email_address>")
            sys.exit(1)
        addr = sys.argv[2]
        print(f"Listening to {addr}...")
        otp = client.wait_for_otp(addr, timeout=300)
        if otp:
            print(f"SUCCESS! Detected OTP Code: {otp}")
        else:
            print("TIMEOUT: No OTP detected.")
            
    else:
        # Default: Create a random inbox and wait for mail/OTP
        print("Creating a temporary email address...")
        try:
            inbox = client.create_inbox()
            email = inbox["address"]
            print(f"\nCreated successfully! Alamat email: {email}")
            print("Token pemilik (owner_token):", inbox["owner_token"])
            print("\nAnda bisa mengirimkan email ke alamat ini sekarang.")
            print("Menunggu email masuk dan mendeteksi kode verifikasi (OTP)...")
            
            otp = client.wait_for_otp(email, timeout=180)
            if otp:
                print(f"\nKODE VERIFIKASI / OTP TERDETEKSI: {otp}\n")
            else:
                print("\nTidak ada email baru / OTP terdeteksi dalam 3 menit.")
        except Exception as e:
            print("Error:", e)
